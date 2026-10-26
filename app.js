// Plesk / Phusion Passenger entry point wrapper.
// Supports starting the production backend whether Plesk's "Application Startup File"
// is set to `backend/dist/index.js` or left at Plesk's default `app.js`.
import "./backend/dist/index.js";
