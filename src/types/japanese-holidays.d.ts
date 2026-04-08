declare module "japanese-holidays" {
  const JapaneseHolidays: {
    isHolidayAt(date: Date, furikae?: boolean): string | false | null | undefined;
    isHoliday(date: Date, furikae?: boolean): string | false | null | undefined;
  };
  export default JapaneseHolidays;
}
