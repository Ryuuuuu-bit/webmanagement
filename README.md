# TeachSchedule — ระบบตารางสอนอาจารย์มหาวิทยาลัย

Scaffold เริ่มต้นตาม Requirement Specification และ System Architecture ที่ยืนยันไว้ Phase 1 ครอบคลุม:

- **FR-1** ระบบ Login แยกสิทธิ์ Admin / Senior / Member (NextAuth + role ใน JWT)
- **FR-2** Dashboard แยกมุมมอง Admin / อาจารย์
- **FR-3** ตารางสอน — อาจารย์ดูของตัวเอง, Admin สร้าง/ลบได้ พร้อมตรวจจับการจองซ้ำซ้อน (FR-15)
- **FR-4** เช็คอิน/เช็คเอาต์ตามตำแหน่ง (browser Geolocation + ตรวจสอบ geofence ฝั่งเซิร์ฟเวอร์)
- **FR-5 / FR-8** ยื่นคำขอลา + workflow อนุมัติ
- **FR-13** ขอรับรองเวลา + workflow อนุมัติ (บันทึกแยกจากเช็คอินจริงผ่าน GPS)
- **FR-17** ตำแหน่ง geofence เก็บเป็นข้อมูล (`CampusLocation`) ไม่ hardcode ในโค้ด

**ยังไม่ได้ทำ (รอยืนยันขอบเขต/ทำในรอบถัดไป):** FR-6 การส่งแผนการสอน, การแก้ไขตารางสอน (ตอนนี้ทำได้แค่เพิ่ม/ลบ), การจัดตารางสอนแทน (FR-14), แจ้งเตือน LINE, รายงาน/Export, ปฏิทินวันหยุด, PDPA consent flow

## เริ่มต้นใช้งาน

**สิ่งที่ต้องมี:** Node.js 20+, PostgreSQL (local ผ่าน Docker หรือใช้ Railway/Neon ก็ได้)

```bash
npm install
cp .env.example .env      # แก้ DATABASE_URL และ NEXTAUTH_SECRET ให้เป็นของจริง
npx prisma migrate dev --name init   # สร้างตารางในฐานข้อมูล
npm run prisma:seed                  # ใส่ข้อมูลตัวอย่าง (อาจารย์/วิชา/ห้อง/ตารางสอน)
npm run dev
```

เปิด http://localhost:3000 แล้วเข้าสู่ระบบด้วยบัญชีทดสอบ

> บัญชี/รหัสผ่านสำหรับทดสอบดูได้ใน `prisma/seed.ts` (ไม่ commit ไว้ใน README เพราะ repo นี้อาจเป็น public)
> ก่อน deploy จริงหรือแชร์ repo นี้กับคนอื่น ให้เปลี่ยนรหัสผ่านที่ seed ไว้ และอีเมลตัวอย่างในนั้นด้วย

## ตั้งค่า Postgres แบบเร็วด้วย Docker

```bash
docker run --name teachschedule-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=webmanagement -p 5432:5432 -d postgres:16
```
แล้วใช้ `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/webmanagement"` ใน `.env`

## จุดที่ควรรู้ก่อนทดสอบเช็คอิน

หน้าเช็คอินขอสิทธิ์ตำแหน่ง (Geolocation) จริงจากเบราว์เซอร์ พิกัด geofence ตัวอย่างที่ seed ไว้เป็นพิกัดสมมติ
(`prisma/seed.ts`) — แก้เป็นพิกัดจริงของอาคารในมหาวิทยาลัยก่อนทดสอบ ไม่งั้นจะเช็คอินไม่ผ่านเพราะอยู่นอกรัศมีเสมอ
(หรือจะลบข้อมูลใน `CampusLocation` ชั่วคราวเพื่อปิดการตรวจสอบตำแหน่งระหว่างพัฒนาก็ได้ — ดู `src/lib/geo.ts`)

## โครงสร้างโปรเจกต์

```
prisma/schema.prisma     โมเดลข้อมูลทั้งหมด (User, Schedule, Attendance, LeaveRequest, TimeAttestation, ...)
prisma/seed.ts           ข้อมูลตัวอย่างสำหรับทดสอบ
src/lib/auth.ts          การตั้งค่า NextAuth (Credentials + role ใน session)
src/lib/geo.ts           คำนวณระยะทาง + ตรวจสอบ geofence (FR-4/FR-17)
src/actions/*.ts         Server Actions ของแต่ละโมดูล (attendance, leave, attest, schedule)
src/app/(app)/*          หน้าเว็บหลังล็อกอิน แยกตามเมนู
src/components/*         UI components ที่ใช้ร่วมกัน
```

## ขั้นตอนถัดไปที่แนะนำ

1. แทนที่พิกัด `CampusLocation` ด้วยพิกัดจริงของมหาวิทยาลัย
2. เพิ่มหน้าแก้ไขตารางสอน (ตอนนี้มีแค่เพิ่ม/ลบ)
3. ต่อ LINE Notify ตอนอนุมัติ/ปฏิเสธคำขอ และตอนแก้ตารางสอน
4. เพิ่มโมดูลแผนการสอน (FR-6) หลังยืนยันขอบเขตกับลูกค้า
5. Deploy ขึ้น Railway ตามที่ระบุใน System Architecture
