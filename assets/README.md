# Title HDR accent

`title-white-hdr.jpg` is a 64 × 64 white SDR base JPEG with a uniform 1.5× gain map, carrying ISO 21496-1 and Adobe HDR gain-map XMP metadata. Encoded using google/libultrahdr commit `66821e0a261aa3a06c0e7c889f52eced52850be1`.

Verified metadata: min/max content boost 1/1.5, gamma 1, SDR/HDR offsets 0, min/max HDR capacity 1/1.5, base colour space enabled. SHA-256: `511edb2c416eb20f902d7b6c5015063ee1169ea9b34c085e02b07a9cc5406d32`.

Only the existing light title text receives this optional accent; the card emoji and branding colours stay unchanged. CSS enables it only on HDR-capable screens with a dark preference, no forced colours, and text-background clipping support. SDR, light preference, print and forced colours retain normal text. A clipped solid text-colour background keeps the title readable if the image is unavailable. Selection has explicit system colours. No glow, filter, animation, JavaScript or extra dependency is involved.

The browser/OS must support gain-map JPEGs in CSS backgrounds. Capability media queries do not prove that a browser actually renders HDR; unsupported decoders use the SDR base. Actual HDR luminance has **not** been physically verified on an HDR display.
