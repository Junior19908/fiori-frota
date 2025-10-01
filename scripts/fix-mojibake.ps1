Param(
  [Parameter(Mandatory=$false)][string]$Root = ".",
  [Parameter(Mandatory=$false)][string[]]$Include = @("*.js","*.xml","*.html","*.json","*.properties")
)

$map = @{
  'ï»¿' = ''                  # UTF-8 BOM literal occasionally present in editors
  'MÃªs' = 'Mês'
  'MÃ©s' = 'Mês'
  'MÃ¡s' = 'Mês'
  'vÃ¡lido' = 'válido'
  'vÃ¡lidos' = 'válidos'
  'ConfiguraÃ§' = 'Configuraç'
  'InformaÃ§' = 'Inform aç'
  'ConexÃ£o' = 'Conexão'
  'PadrÃµes' = 'Padrões'
  'ServiÃ§o' = 'Serviço'
  'UsuÃ¡rio' = 'Usuário'
  'NÃ£o' = 'Não'
  'Ã§' = 'ç'
  'Ã¡' = 'á'
  'Ã©' = 'é'
  'Ã­' = 'í'
  'Ã³' = 'ó'
  'Ãº' = 'ú'
  'Ã£' = 'ã'
  'Ãµ' = 'õ'
  'Ã¢' = 'â'
  'Ãª' = 'ê'
  'Ã®' = 'î'
  'Ã´' = 'ô'
  'Ã¼' = 'ü'
  'Ã'   = 'Á'
}

$files = Get-ChildItem -Recurse -Path $Root -Include $Include -File
foreach($f in $files){
  $text = Get-Content $f.FullName -Raw
  $orig = $text
  foreach($k in $map.Keys){ $text = $text -replace [Regex]::Escape($k), $map[$k] }
  if ($text -ne $orig){ Set-Content $f.FullName $text -Encoding UTF8; Write-Host "fixed: $($f.FullName)" }
}
Write-Host "Mojibake replacements applied." -ForegroundColor Green

