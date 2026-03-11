/**
 * 15分刻みの時刻オプション。営業時間（17:00〜翌05:45）に絞り込み。
 * 空文字は休み用。
 */
const START_HOUR = 17; // 17:00〜
const END_HOUR = 6; // 〜翌05:45（6時は含まない）

function generateTimeOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: "", label: "—" }];
  // 17:00〜23:45
  for (let h = START_HOUR; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  // 00:00〜05:45
  for (let h = 0; h < END_HOUR; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: value });
    }
  }
  return options;
}

export const TIME_OPTIONS = generateTimeOptions();

/** 単日登録用（必須選択、空オプションなし） */
export const TIME_OPTIONS_REQUIRED = TIME_OPTIONS.filter((opt) => opt.value !== "");
