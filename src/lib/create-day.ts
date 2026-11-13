/* TRAK-424: Schedule has no "+" of its own now; the frame's "+" is the one way to add an event. It still opens New event
   on the day the coach picked in Schedule's calendar (TRAK-270), which the page leaves here while it is showing. */
let day: string | null = null
export const setCreateDay = (next: string | null) => { day = next }
export const createDay = () => day
