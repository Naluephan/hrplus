
Dim objExcel, objWorkbook, objSheet
Dim csvFile, xlsxFile

csvFile = "c:\Users\User\Desktop\Naluephan1\saas\hrplus\test_summary.csv"
xlsxFile = "c:\Users\User\Desktop\Naluephan1\saas\hrplus\Test_Summary.xlsx"

Set objExcel = CreateObject("Excel.Application")
objExcel.Visible = False
objExcel.DisplayAlerts = False

' Open CSV
Set objWorkbook = objExcel.Workbooks.Open(csvFile)
Set objSheet = objWorkbook.Sheets(1)

' Format Header
objSheet.Rows(1).Font.Bold = True
objSheet.Columns("A:C").AutoFit

' Save as XLSX
objWorkbook.SaveAs xlsxFile, 51 ' 51 = xlOpenXMLWorkbook

objWorkbook.Close False
objExcel.Quit

WScript.Echo "Converted to " & xlsxFile
