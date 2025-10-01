Param(
  [Parameter(Mandatory=$false)][string]$Root = ".",
  [Parameter(Mandatory=$false)][string[]]$Include = @("*.js","*.xml","*.html","*.json","*.properties")
)

function Test-IsUtf8($bytes){
  try {
    [Text.Encoding]::UTF8.GetString($bytes) | Out-Null
    return $true
  } catch { return $false }
}

function Remove-BOM($text){
  if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) { return $text.Substring(1) }
  return $text
}

$files = Get-ChildItem -Recurse -Path $Root -Include $Include -File
foreach($f in $files){
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  # If already decodes in UTF8, re-write without BOM only
  $utf8Text = $null
  try { $utf8Text = [Text.Encoding]::UTF8.GetString($bytes) } catch { $utf8Text = $null }
  if ($utf8Text -ne $null) {
    $utf8Text = Remove-BOM $utf8Text
    [IO.File]::WriteAllText($f.FullName, $utf8Text, (New-Object Text.UTF8Encoding($false)))
    continue
  }
  # Fallback: decode as Windows-1252 and save as UTF-8
  $cp1252 = [Text.Encoding]::GetEncoding(1252).GetString($bytes)
  $cp1252 = Remove-BOM $cp1252
  [IO.File]::WriteAllText($f.FullName, $cp1252, (New-Object Text.UTF8Encoding($false)))
}
Write-Host "UTF-8 normalization complete for $Root" -ForegroundColor Green

