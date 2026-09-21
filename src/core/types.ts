export type DropReason =
  | 'unsupported-type'
  | 'undecodable'
  | 'unsupported-source'
  | 'cannot-save'
  | 'unsafe-svg'
  | 'name-collision';
export interface ConvertOptions {
  imageDestination: string;
  canSaveImages: boolean;
}
export interface ConvertedImage {
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
}
export interface DroppedImage {
  source: string;
  reason: DropReason;
}
export interface ConvertResult {
  /** No trailing newline, so it can be pasted mid-line. */
  markdown: string;
  images: ConvertedImage[];
  dropped: DroppedImage[];
}
