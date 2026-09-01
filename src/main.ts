import { Notice, Plugin, TFile, TFolder, Vault } from "obsidian";

type TVRecordType = "tv-series" | "tv-season" | "tv-episode";
type Frontmatter = Record<string, unknown>;
type PropertyChanges = Record<string, string | number | boolean>;

const TV_TYPES: TVRecordType[] = ["tv-series", "tv-season", "tv-episode"];
const TV_ROOT = "Film & TV/TV/";

export default class TVProgressSync extends Plugin {
  private seenState = new Map<string, boolean>();
  private queue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
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
        new Notice("TV progress recalculated");
      }
    });

    this.app.workspace.onLayoutReady(() => {
      this.snapshotSeenState();
      void this.enqueue(() => this.recalculateAll());
    });
  }

  private isTVFile(file: TFile | null | undefined): file is TFile {
    return Boolean(file && file.extension === "md" && file.path.startsWith(TV_ROOT));
  }

  private frontmatter(file: TFile): Frontmatter {
    return this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  }

  private recordType(file: TFile): TVRecordType | null {
    const value = this.frontmatter(file).type;
    return typeof value === "string" && TV_TYPES.includes(value as TVRecordType)
      ? (value as TVRecordType)
      : null;
  }

  private snapshotSeenState(): void {
    for (const file of this.tvMarkdownFiles()) {
      if (!this.isTVFile(file) || !this.recordType(file)) continue;
      this.seenState.set(file.path, this.frontmatter(file).seen === true);
    }
  }

  private handleMetadataChange(file: TFile): void {
    if (!this.isTVFile(file)) return;
    const type = this.recordType(file);
    if (!type) return;

    const nextSeen = this.frontmatter(file).seen === true;
    const previousSeen = this.seenState.get(file.path);
    this.seenState.set(file.path, nextSeen);
    if (previousSeen === undefined || previousSeen === nextSeen) return;

    void this.enqueue(() => this.synchronize(file, type, nextSeen));
  }

  private enqueue(operation: () => Promise<void> | void): Promise<void> {
    this.queue = this.queue.then(operation).catch((error: unknown) => {
      console.error("TV Progress Sync", error);
      new Notice("TV Progress Sync encountered an error. See the developer console.");
    });
    return this.queue;
  }

  private scheduleFullRecalculation(): void {
    window.setTimeout(() => {
      void this.enqueue(() => this.recalculateAll());
    }, 250);
  }

  private filesOfType(type: TVRecordType): TFile[] {
    return this.tvMarkdownFiles().filter((file) => {
      return this.isTVFile(file) && this.recordType(file) === type;
    });
  }

  private tvMarkdownFiles(): TFile[] {
    const root = this.app.vault.getAbstractFileByPath(TV_ROOT.slice(0, -1));
    if (!(root instanceof TFolder)) return [];

    const files: TFile[] = [];
    Vault.recurseChildren(root, (entry) => {
      if (entry instanceof TFile && entry.extension === "md") files.push(entry);
    });
    return files;
  }

  private resolvePropertyLink(file: TFile, rawValue: unknown): TFile | null {
    let value: unknown = rawValue;
    if (Array.isArray(rawValue)) value = (rawValue as unknown[])[0];
    if (typeof value !== "string" || !value) return null;
    const text = value;
    const match = text.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
    const linkPath = match ? match[1] : text;
    return this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
  }

  private childrenOf(
    parentFile: TFile,
    childType: TVRecordType,
    relationProperty: "series" | "season"
  ): TFile[] {
    return this.filesOfType(childType).filter((file) => {
      const linkedFile = this.resolvePropertyLink(
        file,
        this.frontmatter(file)[relationProperty]
      );
      return linkedFile?.path === parentFile.path;
    });
  }

  private currentSeen(file: TFile): boolean {
    return this.seenState.get(file.path) ?? this.frontmatter(file).seen === true;
  }

  private async updateProperties(file: TFile, changes: PropertyChanges): Promise<void> {
    const data = this.frontmatter(file);
    const changed = Object.entries(changes).some(([key, value]) => data[key] !== value);
    if (!changed) return;

    if (Object.prototype.hasOwnProperty.call(changes, "seen")) {
      this.seenState.set(file.path, changes.seen === true);
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
      if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
        throw new TypeError(`Invalid frontmatter in ${file.path}`);
      }
      const properties = frontmatter as Record<string, unknown>;
      for (const [key, value] of Object.entries(changes)) properties[key] = value;
    });
  }

  private async updateSeen(file: TFile, value: boolean): Promise<void> {
    if (this.currentSeen(file) === value) return;
    await this.updateProperties(file, { seen: value });
  }

  private regularSeasons(seriesFile: TFile): TFile[] {
    return this.childrenOf(seriesFile, "tv-season", "series").filter((season) => {
      return this.frontmatter(season).counts_toward_completion !== false;
    });
  }

  private regularEpisodes(seasonFile: TFile): TFile[] {
    return this.childrenOf(seasonFile, "tv-episode", "season").filter((episode) => {
      return this.frontmatter(episode).counts_toward_completion !== false;
    });
  }

  private async updateSeriesProgress(seriesFile: TFile): Promise<void> {
    const seasons = this.regularSeasons(seriesFile);
    const seasonsSeen = seasons.filter((season) => this.currentSeen(season)).length;
    const seasonCount = seasons.length;
    const changes: PropertyChanges = {
      season_count: seasonCount,
      seasons_seen: seasonsSeen,
      completion: seasonCount ? Math.round((seasonsSeen / seasonCount) * 100) : 0
    };
    if (seasonCount > 0) changes.seen = seasonsSeen === seasonCount;
    await this.updateProperties(seriesFile, changes);
  }

  private async updateSeasonFromEpisodes(seasonFile: TFile): Promise<void> {
    const episodes = this.regularEpisodes(seasonFile);
    if (!episodes.length) return;
    await this.updateSeen(
      seasonFile,
      episodes.every((episode) => this.currentSeen(episode))
    );
  }

  private async synchronize(file: TFile, type: TVRecordType, seen: boolean): Promise<void> {
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
      const seriesFile = this.resolvePropertyLink(file, this.frontmatter(file).series);
      if (seriesFile) await this.updateSeriesProgress(seriesFile);
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

  private async recalculateAll(): Promise<void> {
    this.snapshotSeenState();
    for (const season of this.filesOfType("tv-season")) {
      await this.updateSeasonFromEpisodes(season);
    }
    for (const series of this.filesOfType("tv-series")) {
      await this.updateSeriesProgress(series);
    }
  }
}
