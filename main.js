var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TVProgressSync
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var TV_TYPES = ["tv-series", "tv-season", "tv-episode"];
var TV_ROOT = "Film & TV/TV/";
var TVProgressSync = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.seenState = /* @__PURE__ */ new Map();
    this.queue = Promise.resolve();
  }
  async onload() {
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.handleMetadataChange(file))
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.scheduleFullRecalculation())
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.scheduleFullRecalculation())
    );
    this.addCommand({
      id: "recalculate-tv-progress",
      name: "Recalculate all TV progress",
      callback: async () => {
        await this.enqueue(() => this.recalculateAll());
        new import_obsidian.Notice("TV progress recalculated");
      }
    });
    this.app.workspace.onLayoutReady(() => {
      this.snapshotSeenState();
      void this.enqueue(() => this.recalculateAll());
    });
  }
  isTVFile(file) {
    return Boolean(file && file.extension === "md" && file.path.startsWith(TV_ROOT));
  }
  frontmatter(file) {
    var _a, _b;
    return (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
  }
  recordType(file) {
    const value = this.frontmatter(file).type;
    return typeof value === "string" && TV_TYPES.includes(value) ? value : null;
  }
  snapshotSeenState() {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isTVFile(file) || !this.recordType(file)) continue;
      this.seenState.set(file.path, this.frontmatter(file).seen === true);
    }
  }
  handleMetadataChange(file) {
    if (!this.isTVFile(file)) return;
    const type = this.recordType(file);
    if (!type) return;
    const nextSeen = this.frontmatter(file).seen === true;
    const previousSeen = this.seenState.get(file.path);
    this.seenState.set(file.path, nextSeen);
    if (previousSeen === void 0 || previousSeen === nextSeen) return;
    void this.enqueue(() => this.synchronize(file, type, nextSeen));
  }
  enqueue(operation) {
    this.queue = this.queue.then(operation).catch((error) => {
      console.error("TV Progress Sync", error);
      new import_obsidian.Notice("TV Progress Sync encountered an error. See the developer console.");
    });
    return this.queue;
  }
  scheduleFullRecalculation() {
    window.setTimeout(() => {
      void this.enqueue(() => this.recalculateAll());
    }, 250);
  }
  filesOfType(type) {
    return this.app.vault.getMarkdownFiles().filter((file) => {
      return this.isTVFile(file) && this.recordType(file) === type;
    });
  }
  resolvePropertyLink(file, rawValue) {
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (!value) return null;
    const text = String(value);
    const match = text.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
    const linkPath = match ? match[1] : text;
    return this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
  }
  childrenOf(parentFile, childType, relationProperty) {
    return this.filesOfType(childType).filter((file) => {
      const linkedFile = this.resolvePropertyLink(
        file,
        this.frontmatter(file)[relationProperty]
      );
      return (linkedFile == null ? void 0 : linkedFile.path) === parentFile.path;
    });
  }
  currentSeen(file) {
    var _a;
    return (_a = this.seenState.get(file.path)) != null ? _a : this.frontmatter(file).seen === true;
  }
  async updateProperties(file, changes) {
    const data = this.frontmatter(file);
    const changed = Object.entries(changes).some(([key, value]) => data[key] !== value);
    if (!changed) return;
    if (Object.prototype.hasOwnProperty.call(changes, "seen")) {
      this.seenState.set(file.path, changes.seen === true);
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(changes)) frontmatter[key] = value;
    });
  }
  async updateSeen(file, value) {
    if (this.currentSeen(file) === value) return;
    await this.updateProperties(file, { seen: value });
  }
  regularSeasons(seriesFile) {
    return this.childrenOf(seriesFile, "tv-season", "series").filter((season) => {
      return this.frontmatter(season).counts_toward_completion !== false;
    });
  }
  regularEpisodes(seasonFile) {
    return this.childrenOf(seasonFile, "tv-episode", "season").filter((episode) => {
      return this.frontmatter(episode).counts_toward_completion !== false;
    });
  }
  async updateSeriesProgress(seriesFile) {
    const seasons = this.regularSeasons(seriesFile);
    const seasonsSeen = seasons.filter((season) => this.currentSeen(season)).length;
    const seasonCount = seasons.length;
    const changes = {
      season_count: seasonCount,
      seasons_seen: seasonsSeen,
      completion: seasonCount ? Math.round(seasonsSeen / seasonCount * 100) : 0
    };
    if (seasonCount > 0) changes.seen = seasonsSeen === seasonCount;
    await this.updateProperties(seriesFile, changes);
  }
  async updateSeasonFromEpisodes(seasonFile) {
    const episodes = this.regularEpisodes(seasonFile);
    if (!episodes.length) return;
    await this.updateSeen(
      seasonFile,
      episodes.every((episode) => this.currentSeen(episode))
    );
  }
  async synchronize(file, type, seen) {
    if (type === "tv-series") {
      for (const season of this.regularSeasons(file)) {
        await this.updateSeen(season, seen);
        for (const episode of this.regularEpisodes(season)) {
          await this.updateSeen(episode, seen);
        }
      }
      await this.updateSeriesProgress(file);
      return;
    }
    if (type === "tv-season") {
      for (const episode of this.regularEpisodes(file)) {
        await this.updateSeen(episode, seen);
      }
      const seriesFile2 = this.resolvePropertyLink(file, this.frontmatter(file).series);
      if (seriesFile2) await this.updateSeriesProgress(seriesFile2);
      return;
    }
    const seasonFile = this.resolvePropertyLink(file, this.frontmatter(file).season);
    if (!seasonFile) return;
    await this.updateSeasonFromEpisodes(seasonFile);
    const seriesFile = this.resolvePropertyLink(
      seasonFile,
      this.frontmatter(seasonFile).series
    );
    if (seriesFile) await this.updateSeriesProgress(seriesFile);
  }
  async recalculateAll() {
    this.snapshotSeenState();
    for (const season of this.filesOfType("tv-season")) {
      await this.updateSeasonFromEpisodes(season);
    }
    for (const series of this.filesOfType("tv-series")) {
      await this.updateSeriesProgress(series);
    }
  }
};
