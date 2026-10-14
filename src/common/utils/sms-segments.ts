// GSM extension characters consume two septets; UCS-2 uses UTF-16 code units.
export function smsSegments(text: string) {
  const basic = new Set([
    ...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ]);
  const extension = new Set([...'^{}\\[~]|€\f']);
  const isUnicode = [...text].some(
    (char) => !basic.has(char) && !extension.has(char),
  );
  const units = isUnicode
    ? text.length
    : [...text].reduce(
        (count, char) => count + (extension.has(char) ? 2 : 1),
        0,
      );
  const single = isUnicode ? 70 : 160;
  const multi = isUnicode ? 67 : 153;
  return {
    charCount: text.length,
    encodedLength: units,
    segments: units <= single ? 1 : Math.ceil(units / multi),
    isUnicode,
    maxSingleSegment: single,
  };
}
