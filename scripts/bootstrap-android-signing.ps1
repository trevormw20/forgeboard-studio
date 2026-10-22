$ErrorActionPreference = 'Stop'
# Generates one stable signing identity. Values are piped directly to a PRIVATE repository secret.
$vaultRepo = 'trevormw20/forgeboard-studio-vault'
$existingNames = gh secret list --repo $vaultRepo --json name --jq '.[].name'
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect private signing-secret names.' }
if ($existingNames -contains 'ANDROID_SIGNING_BUNDLE') { Write-Output 'Stable Android signing is already configured; no key was changed.'; exit 0 }
$opensslPath = 'C:\Program Files\Git\usr\bin\openssl.exe'
if (!(Test-Path -LiteralPath $opensslPath)) { throw 'OpenSSL is required to initialize signing.' }
$signingDir = Join-Path ([IO.Path]::GetTempPath()) ('forgeboard-signing-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $signingDir)
$randomBytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
$env:FORGEBOARD_SIGNING_PASSWORD = [Convert]::ToBase64String($randomBytes)
$keyPath = Join-Path $signingDir 'key.pem'
$certPath = Join-Path $signingDir 'cert.pem'
$p12Path = Join-Path $signingDir 'signing.p12'
try {
    & $opensslPath req -x509 -newkey rsa:3072 -sha256 -days 10000 -keyout $keyPath -out $certPath -passout env:FORGEBOARD_SIGNING_PASSWORD -subj '/CN=Forgeboard Notes/O=Forgeboard'
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate signing certificate.' }
    & $opensslPath pkcs12 -export -in $certPath -inkey $keyPath -passin env:FORGEBOARD_SIGNING_PASSWORD -out $p12Path -name forgeboard -passout env:FORGEBOARD_SIGNING_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Could not package signing certificate.' }
    $bundle = @{password=$env:FORGEBOARD_SIGNING_PASSWORD;p12=[Convert]::ToBase64String([IO.File]::ReadAllBytes($p12Path))} | ConvertTo-Json -Compress
    $bundle | gh secret set ANDROID_SIGNING_BUNDLE --repo $vaultRepo
    if ($LASTEXITCODE -ne 0) { throw 'Could not save the signing bundle to the private repository.' }
    Write-Output 'Stable Android signing bundle saved privately. No credentials were committed.'
} finally {
    $bundle = $null
    Remove-Item Env:\FORGEBOARD_SIGNING_PASSWORD -ErrorAction SilentlyContinue
    $resolvedSigningDir = [IO.Path]::GetFullPath($signingDir)
    $resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedSigningDir.StartsWith($resolvedTempRoot,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolvedSigningDir).StartsWith('forgeboard-signing-')) {
        Remove-Item -LiteralPath $resolvedSigningDir -Recurse -Force
    }
}
