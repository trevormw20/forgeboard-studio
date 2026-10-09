param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [string]$Repository = 'trevormw20/forgeboard-studio-vault',
  [string]$Branch = 'main'
)
$ErrorActionPreference = 'Stop'
$taskFolder = (Resolve-Path -LiteralPath $Folder).Path
if (-not (Test-Path -LiteralPath $taskFolder -PathType Container)) { throw 'Folder must be a directory.' }
foreach ($taskFile in Get-ChildItem -LiteralPath $taskFolder -Filter '*.json' -File) {
  $text = [System.IO.File]::ReadAllText($taskFile.FullName)
  $submission = $text | ConvertFrom-Json
  if ($submission.format -ne 'forgeboard-task' -or $submission.version -ne 1 -or $submission.id -notmatch '^[a-zA-Z0-9._-]{1,120}$' -or -not $submission.subtasks.Count) { throw "Invalid submission: $($taskFile.Name)" }
  $relative = "data/task-inbox/$($submission.id).json"
  $endpoint = "repos/$Repository/contents/$relative"
  # Auth is supplied by the existing GitHub CLI login; credentials never enter files.
  $existingText = & gh api "$endpoint`?ref=$Branch" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $existing = ($existingText -join "`n") | ConvertFrom-Json
    $decoded = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($existing.content -replace '\s',''))
    if ($decoded -ne $text) { throw "Submission $($submission.id) already exists with different content. Use a new id for new work." }
    Write-Output "Already published: $($taskFile.Name)"
    continue
  }
  $payload = @{ message = '[Forgeboard] add chat checklist'; branch = $Branch; content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text)) } | ConvertTo-Json -Compress
  $payload | & gh api $endpoint --method PUT --input - --silent
  if ($LASTEXITCODE -ne 0) { throw "Publish failed for $($taskFile.Name). Check gh auth and private repository access." }
  Write-Output "Published: $($taskFile.Name)"
}
