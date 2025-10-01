Param(
  [Parameter(Mandatory=$false)][string]$Bucket = "sistemagsg.firebasestorage.app",
  [Parameter(Mandatory=$false)][string]$CorsFile = "cors.json"
)

Write-Host "Applying CORS policy to bucket: gs://$Bucket" -ForegroundColor Cyan

# Check gsutil availability
$gsutil = Get-Command gsutil -ErrorAction SilentlyContinue
if (-not $gsutil) {
  Write-Warning "'gsutil' não encontrado. Instale o Google Cloud SDK (https://cloud.google.com/sdk) e autentique-se (gcloud auth login)."
  Write-Host "Depois execute:" -ForegroundColor Yellow
  Write-Host "  gsutil cors set $CorsFile gs://$Bucket" -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path $CorsFile)) {
  Write-Error "Arquivo de CORS '$CorsFile' não encontrado. Certifique-se de rodar a partir da raiz do projeto."
  exit 1
}

Write-Host "Usando arquivo: $CorsFile" -ForegroundColor Green
& gsutil cors set $CorsFile "gs://$Bucket"
$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
  Write-Host "CORS aplicado com sucesso." -ForegroundColor Green
} else {
  Write-Error "Falha ao aplicar CORS (código $exitCode). Verifique permissões da conta e o nome do bucket."
}
