/** "Good morning," / "Good afternoon," / "Good evening," for the device's local time. */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,'
}
