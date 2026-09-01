const assert = require("node:assert");
const Module = require("node:module");

const originalLoad = Module._load;
class Plugin {
  constructor(app) { this.app = app; }
}
class Notice {}
class TFile {
  constructor(path) {
    this.path = path;
    this.extension = "md";
  }
}
class TFolder {
  constructor(path, children = []) {
    this.path = path;
    this.children = children;
  }
}
class Vault {
  static recurseChildren(root, callback) {
    for (const child of root.children) {
      callback(child);
      if (child instanceof TFolder) Vault.recurseChildren(child, callback);
    }
  }
}
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return { Plugin, Notice, TFile, TFolder, Vault };
  return originalLoad.call(this, request, parent, isMain);
};

const TVProgressSync = require("../main.js").default;
const file = (path) => new TFile(path);
const series = file("Film & TV/TV/TV DB/Test Series.md");
const season1 = file("Film & TV/TV/Seasons/Test Series/Season 01.md");
const season2 = file("Film & TV/TV/Seasons/Test Series/Season 02.md");
const episode1 = file("Film & TV/TV/Episodes/Test Series/Season 01/S01E01.md");
const episode2 = file("Film & TV/TV/Episodes/Test Series/Season 01/S01E02.md");
const files = [series, season1, season2, episode1, episode2];
const tvRoot = new TFolder("Film & TV/TV", files);
const byPath = new Map(files.map((entry) => [entry.path, entry]));
const frontmatter = new Map([
  [series.path, { type: "tv-series", seen: false, season_count: 2, seasons_seen: 0 }],
  [season1.path, { type: "tv-season", seen: false, series: "[[Film & TV/TV/TV DB/Test Series|Test Series]]", counts_toward_completion: true }],
  [season2.path, { type: "tv-season", seen: false, series: "[[Film & TV/TV/TV DB/Test Series|Test Series]]", counts_toward_completion: true }],
  [episode1.path, { type: "tv-episode", seen: false, season: "[[Film & TV/TV/Seasons/Test Series/Season 01|Season 01]]", counts_toward_completion: true }],
  [episode2.path, { type: "tv-episode", seen: false, season: "[[Film & TV/TV/Seasons/Test Series/Season 01|Season 01]]", counts_toward_completion: true }]
]);
const app = {
  vault: {
    getAbstractFileByPath: (path) => path === tvRoot.path ? tvRoot : null
  },
  metadataCache: {
    getFileCache: (entry) => ({ frontmatter: frontmatter.get(entry.path) }),
    getFirstLinkpathDest: (linkPath) => byPath.get(`${linkPath}.md`) || null
  },
  fileManager: {
    processFrontMatter: async (entry, callback) => callback(frontmatter.get(entry.path))
  }
};

(async () => {
  const plugin = new TVProgressSync(app);
  plugin.snapshotSeenState();

  await plugin.synchronize(series, "tv-series", true);
  assert.equal(frontmatter.get(season1.path).seen, true);
  assert.equal(frontmatter.get(season2.path).seen, true);
  assert.equal(frontmatter.get(episode1.path).seen, true);
  assert.equal(frontmatter.get(series.path).completion, 100);

  plugin.seenState.set(season1.path, false);
  frontmatter.get(season1.path).seen = false;
  await plugin.synchronize(season1, "tv-season", false);
  assert.equal(frontmatter.get(episode1.path).seen, false);
  assert.equal(frontmatter.get(series.path).seen, false);
  assert.equal(frontmatter.get(series.path).completion, 50);

  plugin.seenState.set(episode1.path, true);
  frontmatter.get(episode1.path).seen = true;
  await plugin.synchronize(episode1, "tv-episode", true);
  assert.equal(frontmatter.get(season1.path).seen, false);

  plugin.seenState.set(episode2.path, true);
  frontmatter.get(episode2.path).seen = true;
  await plugin.synchronize(episode2, "tv-episode", true);
  assert.equal(frontmatter.get(season1.path).seen, true);
  assert.equal(frontmatter.get(series.path).seen, true);

  console.log("Cascade tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
