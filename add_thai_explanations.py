import csv
import os

# Read the CSV results
results = []
with open('test_results_thai.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        results.append(row)

# Translate/annotate with Thai explanations
thai_explanations = {
    'Create Benefit': 'API บันทึกสวัสดิการล้มเหลว - ไม่พบ Toast "เพิ่มสวัสดิการสำเร็จ" (อาจเกิดจาก backend error หรือ validation ไม่ผ่าน)',
    'Create Department': 'ค้นหาแผนกไม่เจอหลัง save - API อาจบันทึกไม่สำเร็จ หรือ Level ไม่มีในระบบ',
    'Create Department With Position': 'Form ไม่ปิดหลัง save - ปุ่ม submit อาจถูก disabled หรือ API มีปัญหา',
    'Delete Department': 'ลบแผนกไม่สำเร็จ - row ยังคงแสดงอยู่หลังกด delete (API อาจมีปัญหา)',
    'Create Workflow': 'ปุ่ม select ผู้อนุมัติถูก disabled - ไม่มีพนักงานในระบบให้เลือกเป็นผู้อนุมัติ',
    'Create Salary Period': 'ค้นหางวดเงินเดือนไม่เจอหลัง save - API อาจบันทึกไม่สำเร็จ (code ซ้ำ หรือ validation error)',
    'Create Fund Registration': 'เชื่อมต่อ server ไม่ได้ - Frontend server ไม่ได้รันหรือรีสตาร์ทระหว่างทดสอบ',
}

# Skip reason explanations
skip_explanations = {
    'No workflows available to delete - skipping test.': 'ไม่มี Workflow ให้ลบ - ข้ามการทดสอบ',
    'No holiday edit buttons available - skipping test.': 'ไม่มีปุ่มแก้ไขวันหยุด - ข้ามการทดสอบ',
    'No holiday delete buttons available - skipping test.': 'ไม่มีปุ่มลบวันหยุด - ข้ามการทดสอบ',
    'Skipping explicit Calendar Delete to prevent wiping out the only test environment calendar.': 'ข้ามการลบปฏิทินเพื่อป้องกันไม่ให้ข้อมูลทดสอบหาย',
    'No shifts available to edit - skipping test.': 'ไม่มีกะการทำงานให้แก้ไข - ข้ามการทดสอบ',
    'No shifts available to delete - skipping test.': 'ไม่มีกะการทำงานให้ลบ - ข้ามการทดสอบ',
    'No separation reasons available to edit - skipping test.': 'ไม่มีเหตุผลการออกให้แก้ไข - ข้ามการทดสอบ',
    'No separation reasons available to delete - skipping test.': 'ไม่มีเหตุผลการออกให้ลบ - ข้ามการทดสอบ',
    'No tag groups available - skipping tag creation test.': 'ไม่มีกลุ่ม Tag - ข้ามการทดสอบสร้าง Tag',
    'No salary periods available to edit - skipping test.': 'ไม่มีงวดเงินเดือนให้แก้ไข - ข้ามการทดสอบ',
    'No salary periods available to delete - skipping test.': 'ไม่มีงวดเงินเดือนให้ลบ - ข้ามการทดสอบ',
    'No fund registrations available to delete - skipping test.': 'ไม่มีการลงทะเบียนกองทุนให้ลบ - ข้ามการทดสอบ',
}

# Update results with Thai explanations
for row in results:
    test_name = row['Test Case']
    status = row['Status']
    message = row['Message']
    
    # Add Thai explanation for failures
    if status == 'FAIL' and test_name in thai_explanations:
        row['Thai Explanation'] = thai_explanations[test_name]
    elif status == 'PASS' and message:
        # Check for skip reasons and translate
        for eng, thai in skip_explanations.items():
            if eng in message:
                row['Thai Explanation'] = thai
                row['Status'] = 'SKIP'  # Mark as SKIP for clarity
                break
        else:
            row['Thai Explanation'] = message
    else:
        row['Thai Explanation'] = ''

# Write updated CSV
with open('test_results_thai_final.csv', 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=['Test Case', 'Status', 'Thai Explanation'])
    writer.writeheader()
    for row in results:
        writer.writerow({
            'Test Case': row['Test Case'],
            'Status': row['Status'],
            'Thai Explanation': row.get('Thai Explanation', '')
        })

print("Updated results written to test_results_thai_final.csv")

# Summary
pass_count = len([r for r in results if r['Status'] == 'PASS'])
fail_count = len([r for r in results if r['Status'] == 'FAIL'])
skip_count = len([r for r in results if r['Status'] == 'SKIP'])
print(f"Total: {len(results)}, PASS: {pass_count}, FAIL: {fail_count}, SKIP: {skip_count}")
