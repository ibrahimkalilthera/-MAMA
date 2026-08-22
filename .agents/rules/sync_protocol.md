# Dual Synchronization Protocol (GitHub & Supabase)

For all future tasks and updates in this repository:
1. **GitHub Automatic Sync**:
   - Whenever code changes or new features are implemented, verify the build (`npm run build`).
   - Automatically stage, commit with a descriptive semantic commit message, and push to `origin main` on GitHub (`https://github.com/ibrahimkalilthera/-MAMA`).
2. **Supabase Real-Time Sync**:
   - Ensure all data models, migrations, and user operations interface directly with Supabase PostgreSQL.
   - Maintain offline queue resilience so transactions record seamlessly and sync whenever online.
