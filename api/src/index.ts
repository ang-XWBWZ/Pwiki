export const PWIKI_API_VERSION = "0.1.0";

export type {
  ApiEnvelope,
  ApiError,
  ApiBackgroundVectors,
  ApiLlmService,
  ApiModel,
  ApiRepositoryInfo,
  ApiReranker,
  ApiSettings,
  ApiSearchHit,
  AddSourceRequest,
  CreateEntryRequest,
  DeleteEntryRequest,
  DeleteEntryResult,
  ModifyEntryRequest,
  MoveEntryRequest,
  RefreshRequest,
  RenameEntryRequest,
  SearchMode,
  ApiEntry,
  ApiFile,
  ApiFilePage,
  ApiSearchRequest,
  ApiSearchResult,
  ApiSource,
  ApiStatus,
  SourceMutationResult,
  SelectModelRequest,
  SemanticSettingsRequest,
  RerankerSettingsRequest,
  SettingsMutationResult,
} from "./contracts.js";

export * from "./service.js";
export * from "./http.js";
export * from "./server.js";
