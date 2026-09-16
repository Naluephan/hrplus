import requests
from datetime import datetime, timedelta

def get_next_available_leave_dates(employee_id, tenant_id=3, duration_days=2, start_offset_days=10):
    url = 'http://localhost:3001/api/v1/leaves'
    headers = {
        'Authorization': 'Bearer 4287b80f113f094a6b2ec64c322e5cf12c395d01655f0b71ffe400d51a31fa5ae56754f8ee587b6dd9d8ee8ec5feca3351f01d0b01254248c180614a855b3655',
        'x-tenant-id': str(tenant_id)
    }
    
    r = requests.get(url, headers=headers)
    if r.status_code != 200:
        raise Exception(f"Failed to fetch leaves: {r.status_code} - {r.text}")
    
    data = r.json()
    items = data.get('items', []) if isinstance(data, dict) else data
    if not items and isinstance(data, dict):
        items = data.get('data', [])
        
    active_leaves = []
    for item in items:
        # Resolve employee ID from root or nested employee object
        emp_id = item.get('employeeId')
        if not emp_id and item.get('employee'):
            emp_id = item.get('employee', {}).get('id')
            
        if emp_id == employee_id and item.get('status') in ['pending', 'approved']:
            try:
                start_dt = datetime.strptime(item.get('startDate')[:10], '%Y-%m-%d')
                end_dt = datetime.strptime(item.get('endDate')[:10], '%Y-%m-%d')
                active_leaves.append((start_dt, end_dt))
            except Exception:
                continue
                
    # Normalize current date to midnight (no time component)
    current_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    offset_date = current_date + timedelta(days=start_offset_days)
    
    check_date = offset_date
    while True:
        proposed_start = check_date
        proposed_end = check_date + timedelta(days=duration_days - 1)
        
        # Verify that all dates in the proposed range are working days (Monday-Friday)
        has_weekend = False
        for i in range(duration_days):
            day = proposed_start + timedelta(days=i)
            if day.weekday() >= 5:  # 5 is Saturday, 6 is Sunday
                has_weekend = True
                break
        
        overlap = False
        if has_weekend:
            overlap = True
        else:
            for start_dt, end_dt in active_leaves:
                if proposed_start <= end_dt and proposed_end >= start_dt:
                    overlap = True
                    break
                
        if not overlap:
            return proposed_start.strftime('%Y-%m-%d'), proposed_end.strftime('%Y-%m-%d')
            
        check_date += timedelta(days=1)

def get_next_available_leave_dates_by_code(employee_code, tenant_id=3, duration_days=2, start_offset_days=10):
    url = f'http://localhost:3001/api/v1/employees'
    headers = {
        'Authorization': 'Bearer 4287b80f113f094a6b2ec64c322e5cf12c395d01655f0b71ffe400d51a31fa5ae56754f8ee587b6dd9d8ee8ec5feca3351f01d0b01254248c180614a855b3655',
        'x-tenant-id': str(tenant_id)
    }
    params = {'search': employee_code}
    r = requests.get(url, headers=headers, params=params)
    if r.status_code != 200:
        raise Exception(f"Failed to fetch employee: {r.status_code}")
    
    data = r.json()
    items = data.get('items', []) if isinstance(data, dict) else data
    if not items and isinstance(data, dict):
        items = data.get('data', [])
        
    employee_id = None
    for item in items:
        if item.get('employeeCode') == employee_code:
            employee_id = item.get('id')
            break
            
    if not employee_id:
        if items:
            employee_id = items[0].get('id')
        else:
            raise Exception(f"Employee {employee_code} not found")
            
    return get_next_available_leave_dates(employee_id, tenant_id, duration_days, start_offset_days)
