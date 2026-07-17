const readerLayoutStorageKey = "zmail.readerLayout.v1";

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export type ReaderLayout = {
  navColumnWidth: number;
  listColumnWidth: number;
};

export function readSavedReaderLayout(storage?: LayoutStorage): ReaderLayout {
  const fallback = {
    navColumnWidth: 256,
    listColumnWidth: 384,
  };

  try {
    const parsed = JSON.parse(
      (storage ?? localStorage).getItem(readerLayoutStorageKey) ?? "null",
    ) as Partial<ReaderLayout> | null;
    if (!parsed) {
      return fallback;
    }
    return {
      navColumnWidth: clamp(Number(parsed.navColumnWidth), 192, 384),
      listColumnWidth: clamp(Number(parsed.listColumnWidth), 280, 640),
    };
  } catch {
    return fallback;
  }
}

export function saveReaderLayout(
  navColumnWidth: number,
  listColumnWidth: number,
  storage?: LayoutStorage,
): void {
  (storage ?? localStorage).setItem(
    readerLayoutStorageKey,
    JSON.stringify({ navColumnWidth, listColumnWidth }),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
