import type { Group } from "../domain/group.js";

export interface Settings {
  directoryName: string;
  fileNameTemplate: string;
}

export interface GroupStorage {
  read(file: string): { group: Group; raw: string };
  readRaw(file: string): string;
  exists(file: string): boolean;
  write(file: string, group: Group, create?: boolean): void;
  delete(file: string): void;
  withLocks<T>(files: string[], operation: () => T): T;
}

export interface RelatedFiles {
  isManagementFile(member: string, groupFile: string, settings: Settings): boolean;
  hash(file: string): { hash: string; identity: string };
  info(file: string): { isFile: boolean; identity: string };
  canonical(file: string): string;
}

export interface Configuration {
  load(cwd: string, config?: string): Settings;
  findGroups(cwd: string, settings: Settings): string[];
  groupFile(name: string, cwd: string, settings: Settings): string;
}

export interface CrosslinkPorts {
  groups: GroupStorage;
  files: RelatedFiles;
  configuration: Configuration;
  digest(content: string): string;
}
