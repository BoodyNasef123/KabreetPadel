# Kabreet Padel Court Booking

A real-time padel court booking app for family retreats.

## Features

- 2 courts with hourly time slots (8:00 AM – 10:00 PM)
- Anyone enters their name and books a slot — no login needed
- Live updates: when someone books, everyone sees it instantly
- Cancel bookings (only if your name matches)
- Mobile-friendly design
- Navigate between days

## Setup

```bash
npm install
npm start
```

The app runs on port 3000 by default.

## Access from other devices

Once running on a laptop/computer connected to your Wi-Fi:

1. Find your computer's local IP address:
   - **Mac/Linux**: run `ifconfig` or `ip addr` and look for something like `192.168.x.x`
   - **Windows**: run `ipconfig` and look for IPv4 Address
2. Everyone on the same Wi-Fi can open: `http://<your-ip>:3000`

## Custom port

```bash
PORT=8080 npm start
```
