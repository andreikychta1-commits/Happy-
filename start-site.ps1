param(
    [switch]$NoBrowser,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$siteRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$serverScript = Join-Path $siteRoot 'birthday-server.cjs'
$sitePorts = 8765..8775

function Get-SiteHealth([int]$Port) {
    $response = $null
    $reader = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/__birthday_health")
        $request.Proxy = $null
        $request.Timeout = 350
        $request.ReadWriteTimeout = 350
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        if ($response.ContentType -notlike 'application/json*' -or $response.ContentLength -gt 4096) { return $null }
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        $health = $reader.ReadToEnd() | ConvertFrom-Json
        if ($health.app -eq 'codex-birthday-local' -and $health.version -eq 1 -and
            $health.port -eq $Port -and
            [string]::Equals([string]$health.root, $siteRoot, [StringComparison]::OrdinalIgnoreCase)) {
            return $health
        }
    } catch { }
    finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
    return $null
}

function Get-NodeRuntime {
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    $candidates = @($bundledNode)
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $candidates += $systemNode.Source }
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    throw 'Node.js was not found. Ask Codex to restore the launcher runtime, or install Node.js from nodejs.org.'
}

function Show-Site([int]$Port) {
    $url = "http://127.0.0.1:$Port/index.html"
    Write-Host "Website is ready: $url"
    Write-Host "Music page: http://127.0.0.1:$Port/cosmos.html"
    Write-Host 'The server is local to this computer. Closing the browser does not stop it.'
    if (-not $NoBrowser) { Start-Process -FilePath $url }
}

function Test-FreePort([int]$Port) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $probe.Server.ExclusiveAddressUse = $true
        $probe.Start()
        return $true
    } catch { return $false }
    finally { $probe.Stop() }
}

try {
    if ($Stop) {
        $stopped = 0
        foreach ($port in $sitePorts) {
            $health = Get-SiteHealth $port
            if (-not $health) { continue }
            if ([string]$health.shutdownToken -notmatch '^[a-f0-9]{64}$') {
                throw 'This server does not support a verified shutdown. No process was stopped.'
            }
            $shutdown = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/__birthday_shutdown" -Headers @{ 'X-Birthday-Token' = [string]$health.shutdownToken } -TimeoutSec 2 -UseBasicParsing
            if (-not $shutdown.stopped) { throw 'The website server did not confirm shutdown.' }
            $stopped++
        }
        if ($stopped) { Write-Host 'The website server has stopped.' }
        else { Write-Host 'The website server was not running.' }
        exit 0
    }

    if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $siteRoot 'index.html') -PathType Leaf)) {
        throw 'Keep this launcher together with birthday-server.cjs and all website files.'
    }

    foreach ($port in $sitePorts) {
        if (Get-SiteHealth $port) {
            Show-Site $port
            exit 0
        }
    }

    $nodeRuntime = Get-NodeRuntime
    foreach ($port in $sitePorts) {
        if (-not (Test-FreePort $port)) { continue }
        $nodeArguments = @(('"' + $serverScript + '"'), '--port', [string]$port)
        $startedServer = Start-Process -FilePath $nodeRuntime -ArgumentList $nodeArguments -WorkingDirectory $siteRoot -WindowStyle Hidden -PassThru
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $health = Get-SiteHealth $port
            if ($health) {
                Show-Site $port
                exit 0
            }
            if ($startedServer.HasExited) { break }
            Start-Sleep -Milliseconds 100
        }
        # Only clean up the exact helper this launcher just created.
        if (-not $startedServer.HasExited) { $startedServer.Kill() }
    }
    throw 'Could not start the local server on ports 8765-8775. Nothing was published online.'
} catch {
    Write-Host ('Launcher error: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
