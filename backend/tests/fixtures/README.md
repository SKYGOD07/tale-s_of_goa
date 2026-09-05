# Recognition test fixtures

Drop your own photographs here. They are gitignored - nothing leaves your machine.

```
tests/fixtures/
├── same_person/
│   ├── you_current.jpg     two DIFFERENT photos of the SAME person
│   └── you_old.jpg         (different day/lighting/angle is ideal)
└── different_person/
    ├── you.jpg             you again
    └── other_person.jpg    a clearly different person
```

Any common image format works (`.jpg`, `.jpeg`, `.png`, `.webp`). The filenames
above are the defaults; the runner picks up whatever two images it finds in each
folder, sorted by name.

Then:

```powershell
cd backend
.\.venv\Scripts\python.exe -m tests.test_recognition
```

Expected:

    same_person/       -> MATCH      (L2 <= 1.128, cosine >= 0.363)
    different_person/  -> NON-MATCH  (L2 >  1.128)

The thresholds are OpenCV's published SFace operating points. They are fixed
constants in `app/services/face_processor.py` and must not be tuned to force a
particular pair to pass.
