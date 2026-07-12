$ErrorActionPreference = "Stop"

$BaseUrl = "https://www.unstablegameswiki.com"
$IndexUrl = "$BaseUrl/index.php?title=Here_To_Slay_Base_Deck_-_Cards_In_This_Deck"

function Decode-Html([string]$text) {
  return [System.Net.WebUtility]::HtmlDecode($text)
}

function Strip-WikiText([string]$text) {
  if ($null -eq $text) { return "" }
  $s = $text -replace "\r", ""
  $s = $s -replace "\[\[File:HtS-(\d+)plus\.png(?:\|[^\]]*)?\]\]", '$1+ '
  $s = $s -replace "\[\[File:HtS-(\d+)minus\.png(?:\|[^\]]*)?\]\]", '$1- '
  $s = $s -replace "\[\[File:HtS-AnyHero[^\]]*\.png(?:\|[^\]]*)?\]\]", "HERO_ICON "
  $s = $s -replace "<br\s*/?>", " "
  $s = $s -replace "'''", ""
  $s = $s -replace "''", ""
  $s = $s -replace "<[^>]+>", ""
  $s = $s -replace "\[\[[^\]|]+\|([^\]]+)\]\]", '$1'
  $s = $s -replace "\[\[([^\]]+)\]\]", '$1'
  $s = $s -replace "\s+", " "
  return (Decode-Html $s).Trim()
}

function Normalize-Text([string]$text) {
  if ($null -eq $text) { return "" }
  $s = (Decode-Html $text).ToLowerInvariant()
  $s = $s -replace "\bequipped hero card\b", "the equipped hero card"
  $s = $s -replace "\ba hero card\b", "1 hero card"
  $s = $s -replace "\ban item card\b", "1 item card"
  $s = $s -replace "\ba card\b", "1 card"
  $s = $s -replace "\bdiscard a\b", "discard 1"
  $s = $s -replace "\bdraw a\b", "draw 1"
  $s = $s -replace "\bdestroy a\b", "destroy 1"
  $s = $s -replace "\bsacrifice a\b", "sacrifice 1"
  $s = $s -replace "\bsteal a\b", "steal 1"
  $s = $s -replace "\bchoose a\b", "choose 1"
  $s = $s -replace "\bfrom your hand\b", ""
  $s = $s -replace "\bthe dice\b", "dice"
  $s = $s -replace "[^a-z0-9+\-/ ]", " "
  $s = $s -replace "\s+", " "
  return $s.Trim()
}

function Get-Section([string]$raw, [string]$heading) {
  $pattern = "(?s)=='''" + [regex]::Escape($heading) + "'''==\s*(.*?)(?=\n=='''|\z)"
  $m = [regex]::Match($raw, $pattern)
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

function Parse-Card([string]$name, [string]$href) {
  $rawUrl = "$BaseUrl$href&action=raw"
  $raw = (Invoke-WebRequest -Uri $rawUrl -UseBasicParsing).Content

  $file = $null
  $mFile = [regex]::Match($raw, "\[\[File:([^|\]]+)")
  if ($mFile.Success) { $file = $mFile.Groups[1].Value }

  $type = $null
  $mType = [regex]::Match($raw, "Type:\s*'''?\s*\[\[[^|\]]+\|([^\]]+)\]\]", "IgnoreCase")
  if (-not $mType.Success) { $mType = [regex]::Match($raw, "Type:\s*\[\[[^|\]]+\|([^\]]+)\]\]", "IgnoreCase") }
  if ($mType.Success) { $type = Strip-WikiText $mType.Groups[1].Value }

  $class = $null
  $mClass = [regex]::Match($raw, "Class:\s*'''?\s*\[\[[^|\]]+\|([^\]]+)\]\]", "IgnoreCase")
  if ($mClass.Success) { $class = Strip-WikiText $mClass.Groups[1].Value }

  $quantity = $null
  $releaseMatches = [regex]::Matches($raw, "\*'''([^']+)''' - ([^\n]*?)Quantity of card:\s*(\d+)", "IgnoreCase")
  foreach ($rel in $releaseMatches) {
    if ($rel.Groups[1].Value -match "February 2024" -and $rel.Groups[2].Value -match "Base Game") {
      $quantity = [int]$rel.Groups[3].Value
    }
  }
  if ($null -eq $quantity) {
    foreach ($rel in $releaseMatches) {
      if ($rel.Groups[1].Value -match "August 2020" -and $rel.Groups[2].Value -match "Base Game") {
        $quantity = [int]$rel.Groups[3].Value
      }
    }
  }

  $main = Get-Section $raw "Main Information"
  $effect = ""
  $mEffect = [regex]::Match($main, "(?s)\*'''(?:KS Print n Play Edition/Base Deck/2nd Edition Base|Base Deck|2nd Edition Base):'''\s*(.*)")
  if ($mEffect.Success) { $effect = Strip-WikiText $mEffect.Groups[1].Value }

  $requirement = $null
  $slayRoll = $null
  $penaltyRoll = $null
  if ($type -eq "Monster Card") {
    $conditions = Get-Section $raw "Conditions To Slay Monster"
    $reqLine = ""
    $mReq = [regex]::Match($conditions, "Requirement:\s*(.*?)<br>", "Singleline")
    if ($mReq.Success) { $reqLine = $mReq.Groups[1].Value }
    $reqParts = @()
    foreach ($className in @("Bard", "Fighter", "Guardian", "Ranger", "Thief", "Wizard")) {
      $classCount = [regex]::Matches($reqLine, "HtS-$className\.png").Count
      for ($n = 0; $n -lt $classCount; $n++) { $reqParts += "1 $className" }
    }
    $heroIcons = [regex]::Matches($reqLine, "HtS-AnyHero").Count
    if ($heroIcons -gt 0) { $reqParts += "$heroIcons Hero" + $(if ($heroIcons -eq 1) { "" } else { "es" }) }
    if ($reqParts.Count -gt 0) { $requirement = $reqParts -join ", " }
    $mPenalty = [regex]::Match($conditions, "HtS-(\d+)minus\.png")
    if ($mPenalty.Success) { $penaltyRoll = [int]$mPenalty.Groups[1].Value }
    $mSlay = [regex]::Match($conditions, "HtS-(\d+)plus\.png")
    if ($mSlay.Success) { $slayRoll = [int]$mSlay.Groups[1].Value }
    $rewards = Get-Section $raw "Rewards for Slaying Monster"
    $mReward = [regex]::Match($rewards, "(?s)\*'''[^']+''' - (.*)")
    if ($mReward.Success) { $effect = Strip-WikiText $mReward.Groups[1].Value }
  } else {
    $mRoll = [regex]::Match($main, "HtS-(\d+)plus\.png")
    if ($mRoll.Success) { $requirement = "$($mRoll.Groups[1].Value)+" }
  }
  $effect = $effect -replace "^\d+\+\s+", ""

  return [pscustomobject]@{
    name = Decode-Html $name
    href = $href
    type = $type
    class = $class
    quantity = $quantity
    imageFile = $file
    effect = $effect
    requirement = $requirement
    slayRoll = $slayRoll
    penaltyRoll = $penaltyRoll
    source = $rawUrl
  }
}

$index = (Invoke-WebRequest -Uri $IndexUrl -UseBasicParsing).Content
$matches = [regex]::Matches($index, '<a href="(/index\.php\?title=Here_To_Slay_-_[^"]+)" title="Here To Slay - ([^"]+)">([^<]+)</a>')
$links = [ordered]@{}
foreach ($m in $matches) {
  $href = Decode-Html $m.Groups[1].Value
  $name = Decode-Html $m.Groups[3].Value
  if (-not $links.Contains($name)) { $links[$name] = $href }
}

$wiki = @()
$i = 0
foreach ($entry in $links.GetEnumerator()) {
  $i++
  Write-Host ("[{0}/{1}] {2}" -f $i, $links.Count, $entry.Key)
  $wiki += Parse-Card $entry.Key $entry.Value
}

$cards = Get-Content -Path "cards.json" -Raw | ConvertFrom-Json
$jsonGroups = $cards | Group-Object -Property name
$jsonByName = @{}
foreach ($g in $jsonGroups) { $jsonByName[$g.Name] = $g.Group }

$wikiByName = @{}
foreach ($w in $wiki) { $wikiByName[$w.name] = $w }

$mismatches = [ordered]@{
  summary = [ordered]@{
    wikiUniqueCards = $wiki.Count
    wikiTotalQuantity = (($wiki | Measure-Object -Property quantity -Sum).Sum)
    jsonTotalCards = $cards.Count
    jsonUniqueCards = $jsonGroups.Count
  }
  missingInJson = @()
  extraInJson = @()
  countMismatches = @()
  fieldMismatches = @()
}

foreach ($w in $wiki) {
  if (-not $jsonByName.ContainsKey($w.name)) {
    $mismatches.missingInJson += $w.name
    continue
  }
  $group = @($jsonByName[$w.name])
  if ($null -ne $w.quantity -and $group.Count -ne $w.quantity) {
    $mismatches.countMismatches += [pscustomobject]@{
      name = $w.name
      wikiQuantity = $w.quantity
      jsonQuantity = $group.Count
    }
  }
  $j = $group[0]
  foreach ($field in @("type", "class", "requirement", "slayRoll", "penaltyRoll")) {
    if ($null -ne $w.$field -and $null -ne $j.$field -and "$($w.$field)" -ne "$($j.$field)") {
      $mismatches.fieldMismatches += [pscustomobject]@{
        name = $w.name
        field = $field
        wiki = $w.$field
        json = $j.$field
      }
    }
  }
  if ($w.imageFile -and $j.imageUrl -and $j.imageUrl -notlike "*$($w.imageFile)*") {
    $mismatches.fieldMismatches += [pscustomobject]@{
      name = $w.name
      field = "imageFile"
      wiki = $w.imageFile
      json = $j.imageUrl
    }
  }
  if ($w.effect -and $j.effect -and (Normalize-Text $w.effect) -ne (Normalize-Text $j.effect)) {
    $mismatches.fieldMismatches += [pscustomobject]@{
      name = $w.name
      field = "effect"
      wiki = $w.effect
      json = $j.effect
    }
  }
}

foreach ($g in $jsonGroups) {
  if (-not $wikiByName.ContainsKey($g.Name)) {
    $mismatches.extraInJson += $g.Name
  }
}

$out = [ordered]@{
  scrapedAt = (Get-Date).ToString("s")
  index = $IndexUrl
  wikiCards = $wiki
  mismatches = $mismatches
}

$out | ConvertTo-Json -Depth 8 | Set-Content -Path "wiki_card_compare.json" -Encoding UTF8
Write-Host "Wrote wiki_card_compare.json"
Write-Host ($mismatches.summary | ConvertTo-Json -Compress)
Write-Host ("Missing in JSON: {0}; extra in JSON: {1}; count mismatches: {2}; field mismatches: {3}" -f $mismatches.missingInJson.Count, $mismatches.extraInJson.Count, $mismatches.countMismatches.Count, $mismatches.fieldMismatches.Count)
