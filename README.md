# Simple Work Schedule Manager

A simplified app to create daily work schedules and integrate with QuickBooks Time.

## Features

✅ **Simple Schedule Creation**
- Select date (auto-displays day of week)
- Choose Project Manager from dropdown 
- Select multiple employees with checkboxes
- Choose job site from dropdown
- Live preview of schedule

✅ **Schedule Management**
- View all schedules in card format
- Edit existing schedules
- Delete schedules
- Filter by date range

✅ **QuickBooks Time Integration**  
- Connect to QB Time (currently mock data)
- Send schedules to QB Time with one click
- Automatic employee sync

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run development server:**
   ```bash
   npm run dev
   ```

3. **Open in browser:**
   ```
   http://localhost:3000
   ```

## How to Use

### Creating a Schedule

1. Click **"+ Create Schedule"**
2. Pick a **date** (day name will auto-display)  
3. Choose **Project Manager** from dropdown
4. Select **employees** using checkboxes
5. Select **job site** from dropdown
6. Click **Save Schedule**

### Using QuickBooks Time

1. Click **"⚠ Connect QB"** 
2. Click **"Connect (Mock Data)"** for testing
3. Send any schedule to QB Time by clicking **"📤 QB"** on a schedule card

### Schedule Format

The app creates schedules in this format:
```
Thursday
MENDY
Miguel, Francisco – 3060 3rd Ave
```

## Available Job Sites

**Street Addresses:**
- 3060 3rd Ave, 2745 Atlantic Ave, 1848 Billingsly St, 650 Southern Blvd
- 52 4th Street, 35 West 125th St, 355 Exterior St, 121 Mount Hope Pl  
- 86-06 135th St, 89-61 162nd St, 104 Fleet Pl, 111 Livingston St
- 1527 Morris Ave, 772 Metropolitan Ave, 636 West 158th St, 1425 50th Ave

**Service Types:**
- Office Work, Site Survey, Equipment Delivery, Maintenance Call

## Project Structure

```
components/
├── ScheduleCard.tsx     # Display schedule cards
├── ScheduleForm.tsx     # Create/edit schedules  
├── QBTimeManager.tsx    # QB Time integration
hooks/
├── useQBTime.ts         # QB Time logic
utils/
├── storage.ts           # Data persistence
types/
├── schedule.ts          # TypeScript definitions
```

## Available PMs

- MENDY, SHABSI, TULY, RAFFI, SHULEM, JEDD

## Available Employees

Miguel, Francisco, Caydon, Victor G, Luis M., Bryan, Jesus, Williams, Ansel, Luis, Ton, Kerwin, Jovany, Charles, Jimmy ty, Eliver, Kevin, Perez, Iqram, Lim, Winner, Diego, Jonathon, Ericson, Marcus, Javier, Christian, Jose L, Victor, Erick, Carlos, Merek

---

**Next Steps**: Replace mock QB Time API calls with real QuickBooks Time OAuth integration.
