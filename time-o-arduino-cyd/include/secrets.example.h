/* =============================================================================
   Template for include/secrets.h — copy this file, drop the ".example", and
   fill in your own values:

       cp include/secrets.example.h include/secrets.h

   secrets.h is gitignored. This template is not, so never put a real key here.

   Note that these end up as plain strings inside firmware.bin. Keeping them out
   of git keeps them off GitHub; it does not protect them from anyone holding the
   compiled binary or the board itself.
   ============================================================================= */

#pragma once

#define WIFI_SSID      "your-ssid"
#define WIFI_PASSWORD  "your-password"

#define API_BASE   "https://timr0.vercel.app"
#define API_KEY    "to_live_xxxxxxxxxxxxxxxx"   // issued in the app under "API"
