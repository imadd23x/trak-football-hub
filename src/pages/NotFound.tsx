import { Link } from "react-router-dom";

/* TRAK-433: the page a wrong address lands on speaks like the rest of Trak (sentence case, plain words) and does not log a
   console error for a visit, which is not a fault in the app. It still sits outside the coach's frame, as the route does. */
const NotFound = () => (
  <div className="flex min-h-screen items-center justify-center bg-ground px-5">
    <div className="grid max-w-sm gap-2 text-center">
      <h1 className="text-xl font-medium text-ink">We can't find that page</h1>
      <p className="text-sm text-ink-3">The address may be wrong, or the page may have moved.</p>
      <Link to="/" className="mt-2 text-sm text-primary underline">Go to Home</Link>
    </div>
  </div>
);

export default NotFound;
