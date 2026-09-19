param([Parameter(Mandatory = $true)][string]$SpecPath)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$spec = Get-Content -Raw -Path $SpecPath | ConvertFrom-Json
$data = New-Object System.Windows.Forms.DataObject
if ($null -ne $spec.html) {
  $fragment = "<html><body><!--StartFragment-->$($spec.html)<!--EndFragment--></body></html>"
  $header = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
  $headerLength = ($header -f 0, 0, 0, 0).Length
  $startFragment = $headerLength + $fragment.IndexOf('<!--StartFragment-->') + 20
  $endFragment = $headerLength + $fragment.IndexOf('<!--EndFragment-->')
  $cfHtml = ($header -f $headerLength, ($headerLength + $fragment.Length), $startFragment, $endFragment) + $fragment
  $data.SetData([System.Windows.Forms.DataFormats]::Html, $cfHtml)
}
if ($null -ne $spec.text) { $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $spec.text) }
if ($null -ne $spec.pngBase64) {
  $stream = New-Object System.IO.MemoryStream (, [Convert]::FromBase64String($spec.pngBase64))
  $data.SetImage([System.Drawing.Image]::FromStream($stream))
}
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
