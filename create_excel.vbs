Set objExcel = CreateObject("Excel.Application")
Set objWorkbook = objExcel.Workbooks.Open("C:\Users\User\Desktop\Naluephan1\saas\hrplus\test_results_thai_final.csv")
objExcel.DisplayAlerts = False

' Format
With objWorkbook.Worksheets(1)
    ' Headers
    .Cells(1, 1).Value = "Test Case"
    .Cells(1, 2).Value = "สถานะ"
    .Cells(1, 3).Value = "หมายเหตุ (ภาษาไทย)"
    
    ' Bold headers
    .Rows("1:1").Font.Bold = True
    
    ' Auto fit columns
    .Columns("A:C").AutoFit
    
    ' Set column A width
    .Columns("A").ColumnWidth = 40
    .Columns("C").ColumnWidth = 80
    
    ' Conditional formatting for status
    Dim lastRow
    lastRow = .Cells(.Rows.Count, 1).End(-4162).Row ' xlUp
    
    For i = 2 To lastRow
        Select Case .Cells(i, 2).Value
            Case "PASS"
                .Cells(i, 2).Interior.Color = RGB(198, 239, 206) ' Green
            Case "FAIL"
                .Cells(i, 2).Interior.Color = RGB(255, 199, 206) ' Red
            Case "SKIP"
                .Cells(i, 2).Interior.Color = RGB(255, 235, 156) ' Yellow
        End Select
    Next
End With

' Save as xlsx
objWorkbook.SaveAs "C:\Users\User\Desktop\Naluephan1\saas\hrplus\Test_Results_Thai.xlsx", 51
objWorkbook.Close
objExcel.Quit

WScript.Echo "Excel file created: Test_Results_Thai.xlsx"
