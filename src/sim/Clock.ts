import { DAYS_PER_MONTH, MONTHS_PER_YEAR, TICKS_PER_DAY } from './constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Cities are founded in early spring. */
const START_MONTH = 2;

export class Clock {
  tick = 0;

  get day(): number {
    return Math.floor(this.tick / TICKS_PER_DAY);
  }

  get hour(): number {
    return this.tick % TICKS_PER_DAY;
  }

  get monthIndex(): number {
    return Math.floor(this.day / DAYS_PER_MONTH);
  }

  get month(): number {
    return (this.monthIndex + START_MONTH) % MONTHS_PER_YEAR;
  }

  get year(): number {
    return Math.floor((this.monthIndex + START_MONTH) / MONTHS_PER_YEAR) + 1;
  }

  get dayOfMonth(): number {
    return (this.day % DAYS_PER_MONTH) + 1;
  }

  dateString(): string {
    return `${MONTHS[this.month]} ${this.dayOfMonth}, Year ${this.year}`;
  }

  static monthName(m: number): string {
    return MONTHS[((m % 12) + 12) % 12];
  }

  /** Calendar month (0 = January) of a month index. */
  static monthOfYear(monthIndex: number): number {
    return (monthIndex + START_MONTH) % MONTHS_PER_YEAR;
  }

  /** "April, Year 2" for a month index. */
  static monthLabel(monthIndex: number): string {
    const m = monthIndex + START_MONTH;
    return `${MONTHS_LONG[m % MONTHS_PER_YEAR]}, Year ${Math.floor(m / MONTHS_PER_YEAR) + 1}`;
  }
}
