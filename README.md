# Obsidian TV Progress Sync

An Obsidian plugin that keeps a `seen` property synchronized across television series, seasons, and episodes.

## Behavior

- Checking a series checks every linked season and episode.
- Unchecking a series clears every linked season and episode.
- Checking or clearing a season updates its episodes and recalculates its series.
- When every episode is checked, its season is checked automatically.
- When every season is checked, its series is checked automatically.
- Series progress properties are maintained automatically:
  - `season_count`
  - `seasons_seen`
  - `completion`

## Expected note schema

The plugin scans Markdown files under `Film & TV/TV/`.

### Series

```yaml
---
type: tv-series
seen: false
season_count: 2
seasons_seen: 0
completion: 0
---
```

### Season

```yaml
---
type: tv-season
series: "[[Film & TV/TV/TV DB/Example|Example]]"
season_number: 1
counts_toward_completion: true
seen: false
---
```

### Episode

```yaml
---
type: tv-episode
series: "[[Film & TV/TV/TV DB/Example|Example]]"
season: "[[Film & TV/TV/Seasons/Example/Season 01|Season 01]]"
episode_number: 1
counts_toward_completion: true
seen: false
---
```

## Development

```bash
npm install
npm run dev
```

Create a production build and run the cascade tests:

```bash
npm test
```

## Manual installation

1. Run `npm run build`.
2. Create `<vault>/.obsidian/plugins/tv-progress-sync/`.
3. Copy `main.js`, `manifest.json`, and `versions.json` into that directory.
4. Enable **TV Progress Sync** under Obsidian's community plugins.

The command palette includes **TV Progress Sync: Recalculate all TV progress** for repairing derived progress values after bulk edits.
