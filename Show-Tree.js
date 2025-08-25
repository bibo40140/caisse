function Show-Tree {
    param (
        [string]$Path = ".",
        [string]$Indent = ""
    )

    $items = Get-ChildItem -LiteralPath $Path | Where-Object { $_.Name -ne "node_modules" }

    for ($i=0; $i -lt $items.Count; $i++) {
        $item = $items[$i]
        $isLast = ($i -eq $items.Count - 1)
        $connector = if ($isLast) { "└── " } else { "├── " }

        Write-Output "$Indent$connector$item"

        if ($item.PSIsContainer) {
            $newIndent = if ($isLast) { "$Indent    " } else { "$Indent│   " }
            Show-Tree -Path $item.FullName -Indent $newIndent
        }
    }
}

Show-Tree | Out-File arborescence.txt -Encoding utf8
sqdfgsdfgsdfg