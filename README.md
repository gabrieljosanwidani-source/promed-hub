# ProMed Hub — Josan x ProMed

Portal full-stack untuk satu angkatan. Versi ini sudah disiapkan untuk Cloudflare Workers + D1 + R2.

## Yang sudah berfungsi

- Login mahasiswa dengan NPM + tanggal lahir.
- Tanggal lahir tidak disimpan mentah; yang disimpan di D1 adalah SHA-256 hash.
- Satu device mahasiswa dapat dibatasi lewat pengaturan `max_devices_per_student`.
- Admin bisa mengubah total slot device, misalnya 45 -> 60, dari Admin Panel.
- Admin bisa reset device mahasiswa tanpa mengubah kode program.
- Admin menambah mahasiswa satu per satu.
- Admin upload manual materi PDF/PPT/DOCX. Setelah dipublikasikan, file yang sama terlihat di semua akun mahasiswa.
- Admin upload kuis HTML/JSON. Kuis yang sama terlihat di semua akun.
- Admin membuat tugas. Instruksi tugas bersifat bersama.
- Mahasiswa upload karya sendiri. Pengumpulan disimpan terpisah berdasarkan akun mahasiswa.
- Admin dapat melihat seluruh pengumpulan.
- File disimpan di R2, metadata di D1.
- Desain profesional dengan branding `Josan x ProMed`.

## Penting

Prototype ini memakai D1 + R2 yang kamu hubungkan sendiri. Jangan memasukkan `ADMIN_KEY` ke GitHub atau ke source code. Setel sebagai secret Worker.

## 1. Siapkan project

Install Wrangler jika belum ada:

```bash
npm install
```

Login:

```bash
npx wrangler login
```

## 2. D1

Kamu boleh memakai database D1 yang sudah kamu punya (`kuis-database`) agar tabel lama tetap berada di database yang sama. Tabel ProMed Hub diawali `pm_`, jadi tidak memakai nama `access_codes` milik sistem kuis lama.

Lihat database dan ID:

```bash
npx wrangler d1 list
```

Lalu edit `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "kuis-database",
    "database_id": "ISI_UUID_D1_KAMU"
  }
]
```

Apply schema ke database remote:

```bash
npx wrangler d1 execute kuis-database --remote --file=schema.sql
```

## 3. R2

Buat bucket untuk file ProMed Hub:

```bash
npx wrangler r2 bucket create promed-hub-files
```

Lalu edit `wrangler.jsonc`:

```jsonc
"r2_buckets": [
  {
    "binding": "FILES",
    "bucket_name": "promed-hub-files"
  }
]
```

## 4. Admin key

Set secret. Jangan tulis nilainya di file:

```bash
npx wrangler secret put ADMIN_KEY
```

Masukkan admin key ketika diminta.

## 5. Deploy

```bash
npx wrangler deploy
```

Setelah berhasil, Cloudflare akan memberikan URL Worker.

## Alur admin

Admin login -> Admin Panel -> tambah mahasiswa -> ubah slot device -> upload materi/kuis -> buat tugas -> cek pengumpulan.

## Alur mahasiswa

Mahasiswa login NPM + tanggal lahir -> materi bersama -> kuis bersama -> lihat tugas -> upload karya sendiri -> cek pengumpulan sendiri.

## Pengaturan device

Default:

- total device: 45
- maksimum device per mahasiswa: 1

Contoh mengubah total slot:

`45 -> 60`

dilakukan langsung di Admin Panel, tidak perlu mengedit `worker.js`.

## Hubungan dengan web kuis lama

Paket ini dibuat sebagai Worker terpisah supaya situs kuis `kuis-komunikasi-massa` yang sudah berjalan tidak perlu dirusak. Setelah ProMed Hub stabil, kuis lama bisa dipindahkan bertahap ke menu Kuis ProMed Hub.
