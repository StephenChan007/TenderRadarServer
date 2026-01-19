# run-debug.ps1

$env:MYSQL_URL="mysql://root:13597574463CpFlj@10.40.105.130:3306/tenderradar?charset=utf8"
$env:PORT="80"
$env:ENABLE_CRAWLER="true"
$env:CRAWL_CRON="*/5 * * * *"

if (-not (Test-Path "node_modules")) { npm install }

Write-Host "Running debug..." -ForegroundColor Cyan
node debug.js