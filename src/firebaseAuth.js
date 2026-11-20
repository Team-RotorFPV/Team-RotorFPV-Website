import { getAuth } from "firebase/auth";
import { app } from "./firebase";

// Only the admin dashboard needs Firebase Auth; keep it out of public pages.
export const auth = getAuth(app);
