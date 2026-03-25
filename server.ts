import express from "express";
import fs from "fs";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  console.log("Starting VoiceIt Backend...");
  console.log("Environment Variables:", {
    NODE_ENV: process.env.NODE_ENV,
    VITE_API_URL: process.env.VITE_API_URL,
    VITE_PUBLIC_BASE_URL: process.env.VITE_PUBLIC_BASE_URL
  });
  
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.use(express.json());
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use(express.urlencoded({ extended: true }));

  let db: any;
  const isDemoMode = process.env.DEMO_MODE === "true" || process.env.RENDER === "true";
  try {
    const dbPath = isDemoMode ? ":memory:" : "voiceit.db";
    db = new Database(dbPath);
    console.log(`Database connected (${isDemoMode ? "In-Memory" : "File-based"}).`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        branding_json TEXT,
        monthly_limit_usd REAL DEFAULT 100.0,
        warning_threshold_percent INTEGER DEFAULT 80,
        hard_stop_enabled BOOLEAN DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS usage_logs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'voice' or 'text'
        units REAL NOT NULL, -- seconds for voice, chars for text
        cost_usd REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(account_id) REFERENCES accounts(id),
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(session_id) REFERENCES sessions(id),
        FOREIGN KEY(message_id) REFERENCES messages(id)
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        instructions TEXT,
        FOREIGN KEY(account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        content TEXT,
        page_count INTEGER,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        project_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sources_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
    `);
    console.log("Database schema initialized.");

    // Ensure content column exists if table was created earlier without it
    try {
      db.prepare("ALTER TABLE documents ADD COLUMN content TEXT").run();
      console.log("Added content column to documents table.");
    } catch (e) {}

    // Add file storage columns to documents table
    try {
      db.prepare("ALTER TABLE documents ADD COLUMN original_filename TEXT").run();
      db.prepare("ALTER TABLE documents ADD COLUMN stored_filename TEXT").run();
      db.prepare("ALTER TABLE documents ADD COLUMN file_path TEXT").run();
      db.prepare("ALTER TABLE documents ADD COLUMN file_url TEXT").run();
      db.prepare("ALTER TABLE documents ADD COLUMN mime_type TEXT").run();
      console.log("Added file storage columns to documents table.");
    } catch (e) {}

    // Account Model Patch Migrations
    try {
      db.prepare("ALTER TABLE users ADD COLUMN account_id TEXT").run();
      db.prepare("UPDATE users SET account_id = 'acc_default' WHERE account_id IS NULL").run();
      console.log("Migrated users table for account scoping.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE accounts ADD COLUMN monthly_limit_usd REAL DEFAULT 100.0").run();
      db.prepare("ALTER TABLE accounts ADD COLUMN warning_threshold_percent INTEGER DEFAULT 80").run();
      db.prepare("ALTER TABLE accounts ADD COLUMN hard_stop_enabled BOOLEAN DEFAULT 1").run();
      console.log("Added billing columns to accounts table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'text'").run();
      console.log("Added mode column to sessions table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE sessions ADD COLUMN latitude REAL").run();
      db.prepare("ALTER TABLE sessions ADD COLUMN longitude REAL").run();
      db.prepare("ALTER TABLE sessions ADD COLUMN country TEXT").run();
      db.prepare("ALTER TABLE sessions ADD COLUMN city TEXT").run();
      db.prepare("ALTER TABLE sessions ADD COLUMN device_type TEXT").run();
      console.log("Added location and device columns to sessions table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE messages ADD COLUMN sentiment TEXT").run();
      console.log("Added sentiment column to messages table.");
    } catch (e) {}
  } catch (err) {
    console.error("Database initialization failed:", err);
  }

  // API Routes
  app.get("/api/health", (req, res) => {
    console.log("[API] Health check requested");
    res.json({ 
      status: "ok", 
      mode: process.env.NODE_ENV, 
      isDemoMode,
      timestamp: new Date().toISOString(),
      database: db ? "connected" : "disconnected"
    });
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[API Request] ${req.method} ${req.path} - ${new Date().toISOString()}`);
    }
    next();
  });

  function getAccountBillingAccess(accountId: string) {
    const acc = db.prepare(`
      SELECT a.*, 
             COALESCE((SELECT SUM(cost_usd) FROM usage_logs WHERE account_id = a.id), 0) as totalSpentUsd
      FROM accounts a WHERE id = ?
    `).get(accountId) as any;

    if (!acc) return null;

    const totalSpent = acc.totalSpentUsd || 0;
    const limit = acc.monthly_limit_usd ?? 100.0;
    const warningThresholdPct = acc.warning_threshold_percent ?? 80;
    const warningThreshold = warningThresholdPct / 100;
    const hardStopEnabled = acc.hard_stop_enabled === 1;
    
    let status = 'active';
    if (totalSpent >= limit) status = 'capped';
    else if (totalSpent >= limit * warningThreshold) status = 'warning';

    const balance = limit - totalSpent;
    const isBlocked = hardStopEnabled && balance <= 0;

    return {
      id: acc.id,
      name: acc.name,
      monthly_limit_usd: limit,
      totalSpentUsd: totalSpent,
      balance,
      status,
      warning_threshold_pct: warningThresholdPct,
      hard_stop_enabled: hardStopEnabled,
      isBlocked
    };
  }

  // Middleware to check database connection
  const checkDb = (req: any, res: any, next: any) => {
    if (!db) {
      return res.status(503).json({ error: "Database not initialized. Check server logs for errors." });
    }
    next();
  };

  app.get("/api/projects", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      
      let projects;
      const query = `
        SELECT p.*, 
               COALESCE((SELECT SUM(cost_usd) FROM usage_logs WHERE project_id = p.id AND type = 'voice'), 0) as voiceCreditUsedUsd,
               COALESCE((SELECT SUM(cost_usd) FROM usage_logs WHERE project_id = p.id AND type = 'text'), 0) as textCreditUsedUsd,
               COALESCE((SELECT SUM(cost_usd) FROM usage_logs WHERE project_id = p.id), 0) as totalCreditUsedUsd
        FROM projects p
      `;

      if (user && user.role !== 'admin') {
        projects = db.prepare(`${query} WHERE p.account_id = ?`).all(user.account_id);
      } else {
        projects = db.prepare(query).all();
      }
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", checkDb, (req, res) => {
    try {
      const { title, description, instructions, account_id } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });
      
      const id = 'proj_' + Math.random().toString(36).substring(7);
      db.prepare("INSERT INTO projects (id, account_id, title, description, instructions) VALUES (?, ?, ?, ?, ?)")
        .run(id, account_id || 'acc_default', title, description, instructions);
      res.json({ id, title, description, account_id: account_id || 'acc_default' });
    } catch (err) {
      console.error("Project creation failed:", err);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.put("/api/projects/:id", checkDb, (req, res) => {
    try {
      const { title, description, instructions, account_id } = req.body;
      db.prepare("UPDATE projects SET title = ?, description = ?, instructions = ?, account_id = ? WHERE id = ?")
        .run(title, description, instructions, account_id || 'acc_default', req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", checkDb, (req, res) => {
    try {
      db.prepare("DELETE FROM documents WHERE project_id = ?").run(req.params.id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  app.get("/api/projects/:id/documents", checkDb, (req, res) => {
    try {
      const docs = db.prepare("SELECT * FROM documents WHERE project_id = ?").all(req.params.id) as any[];
      console.log(`Retrieved ${docs.length} documents for project ${req.params.id}.`);
      docs.forEach(d => {
        console.log(`Document: ${d.title}, ID: ${d.id}, Content length: ${d.content?.length || 0}, Snippet: ${d.content?.substring(0, 50).replace(/\n/g, ' ')}...`);
      });
      res.json(docs);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/projects/:id/documents", checkDb, upload.array('files'), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const results = [];

      if (files && files.length > 0) {
        const require = createRequire(import.meta.url);
        const pdfModule = require("pdf-parse");
        const { PDFParse } = pdfModule;
        const mammoth = require("mammoth");
        const WordExtractor = require("word-extractor");
        
        console.log("Resolved PDFParse type:", typeof PDFParse);
        
        const extractor = new WordExtractor();

        for (const file of files) {
          let title = file.originalname;
          let content = "";
          let pageCount = 1;
          const ext = path.extname(title).toLowerCase();

          try {
            if (ext === '.pdf') {
              console.log(`Parsing PDF: ${title}, size: ${file.buffer.length} bytes`);
              
              if (typeof PDFParse !== 'function') {
                // Fallback to the standard function call if PDFParse is not a class
                const pdfParser = typeof pdfModule === 'function' ? pdfModule : pdfModule.default;
                if (typeof pdfParser === 'function') {
                  const data = await pdfParser(file.buffer);
                  content = data.text || "";
                  pageCount = data.numpages || 1;
                } else {
                  throw new Error(`Could not resolve pdf-parse. Type: ${typeof pdfModule}`);
                }
              } else {
                const parser = new PDFParse({ data: file.buffer });
                const data = await parser.getText();
                console.log(`PDFParse result for ${title}:`, { 
                  hasText: !!data.text, 
                  textLength: data.text?.length
                });
                content = data.text || "";
                // PDFParse might not return pageCount in the same way, but let's assume it works or we'll fix it if needed.
                // For now, restoring the requested logic.
              }
            } else if (ext === '.docx') {
              console.log(`Parsing DOCX: ${title}, size: ${file.buffer.length} bytes`);
              const result = await mammoth.extractRawText({ buffer: file.buffer });
              content = result.value || "";
              pageCount = 1; // Mammoth doesn't easily provide page count
            } else if (ext === '.doc') {
              console.log(`Parsing DOC: ${title}, size: ${file.buffer.length} bytes`);
              const doc = await extractor.extract(file.buffer);
              content = doc.getBody() || "";
              pageCount = 1;
            } else {
              console.warn(`Unsupported file type: ${ext} for file ${title}`);
              // Try as plain text if it's not a known binary format
              content = file.buffer.toString('utf8');
            }
            
            console.log(`Extracted ${content?.length || 0} characters from ${ext.toUpperCase()}: ${title}`);
          } catch (parseError) {
            console.error(`Error parsing ${ext.toUpperCase()} ${title}:`, parseError);
            content = "";
          }

          if (!content || content.trim().length === 0) {
            console.warn(`Warning: No text content extracted from ${title}.`);
          }

          const id = 'doc_' + Math.random().toString(36).substring(7);
          
          // Save file to disk if it's a real file upload
          let fileUrl = null;
          let storedFilename = null;
          let filePath = null;
          
          if (file.buffer) {
            storedFilename = `${id}_${title.replace(/[^a-z0-9.]/gi, '_').toLowerCase()}`;
            filePath = path.join(uploadsDir, storedFilename);
            fs.writeFileSync(filePath, file.buffer);
            fileUrl = `/uploads/documents/${storedFilename}`;
          }

          db.prepare("INSERT INTO documents (id, project_id, title, content, page_count, original_filename, stored_filename, file_path, file_url, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(id, req.params.id, title, content, pageCount, title, storedFilename, filePath, fileUrl, file.mimetype);
          
          results.push({ id, title, pageCount, fileUrl });
        }
      } else if (req.body.content) {
        const title = req.body.title || "Untitled Document";
        const content = req.body.content;
        const pageCount = 1;
        const id = 'doc_' + Math.random().toString(36).substring(7);
        db.prepare("INSERT INTO documents (id, project_id, title, content, page_count) VALUES (?, ?, ?, ?, ?)")
          .run(id, req.params.id, title, content, pageCount);
        results.push({ id, title, pageCount });
      }

      if (results.length === 0) {
        return res.status(400).json({ error: "No content or files provided" });
      }

      res.json(results);
    } catch (error) {
      console.error("Document Upload Error:", error);
      res.status(500).json({ error: "Failed to process documents" });
    }
  });

  app.delete("/api/documents/:id", checkDb, (req, res) => {
    try {
      db.prepare("DELETE FROM documents WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  app.get("/api/users", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;

      let users;
      if (user && user.role !== 'admin') {
        users = db.prepare(`
          SELECT u.*, a.name as account_name 
          FROM users u 
          LEFT JOIN accounts a ON u.account_id = a.id 
          WHERE u.account_id = ?
        `).all(user.account_id);
      } else {
        users = db.prepare(`
          SELECT u.*, a.name as account_name 
          FROM users u 
          LEFT JOIN accounts a ON u.account_id = a.id
        `).all();
      }
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get('/api/users/:id', checkDb, (req, res) => {
    const { id } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });

  app.post('/api/users', checkDb, (req, res) => {
    const { name, email, role, account_id } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const id = 'u_' + Math.random().toString(36).substr(2, 9);
    db.prepare(`
      INSERT INTO users (id, name, email, role, account_id, last_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, email, role, account_id || 'acc_default', new Date().toISOString());

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json(newUser);
  });

  app.put('/api/users/:id', checkDb, (req, res) => {
    const { id } = req.params;
    const { name, email, role, account_id } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, role = ?, account_id = ?
      WHERE id = ?
    `).run(
      name || user.name,
      email || user.email,
      role || user.role,
      account_id || user.account_id,
      id
    );

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json(updatedUser);
  });

  app.delete('/api/users/:id', checkDb, (req, res) => {
    const { id } = req.params;
    
    // Prevent deleting the last admin
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
    if (user?.role === 'admin') {
      const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = "admin"').get() as any;
      if (adminCount.count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last administrator' });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  });

  // Accounts API
  app.get("/api/accounts", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      
      let accounts;
      if (user && user.role !== 'admin') {
        accounts = db.prepare(`
          SELECT a.*, 
                 COALESCE((SELECT SUM(cost_usd) FROM usage_logs WHERE account_id = a.id), 0) as totalSpentUsd
          FROM accounts a WHERE id = ?
        `).all(user.account_id);
      } else {
        accounts = db.prepare(`
          SELECT a.*, 
                 COALESCE((SELECT SUM(cost_usd) FROM usage_logs WHERE account_id = a.id), 0) as totalSpentUsd
          FROM accounts a
        `).all();
      }

      const enrichedAccounts = accounts.map((acc: any) => {
        const totalSpent = acc.totalSpentUsd || 0;
        const limit = acc.monthly_limit_usd ?? 100.0;
        const warningThreshold = (acc.warning_threshold_percent ?? 80) / 100;
        const hardStopEnabled = acc.hard_stop_enabled === 1;
        
        let status = 'active';
        if (totalSpent >= limit) status = 'capped';
        else if (totalSpent >= limit * warningThreshold) status = 'warning';

        return {
          ...acc,
          balance: limit - totalSpent,
          status,
          isBlocked: hardStopEnabled && (limit - totalSpent) <= 0
        };
      });

      res.json(enrichedAccounts);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.post("/api/accounts", checkDb, (req, res) => {
    try {
      const { name, branding_json, monthly_limit_usd, warning_threshold_percent, hard_stop_enabled } = req.body;
      const id = 'acc_' + Math.random().toString(36).substring(7);
      db.prepare("INSERT INTO accounts (id, name, branding_json, monthly_limit_usd, warning_threshold_percent, hard_stop_enabled) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, name, branding_json || '{}', monthly_limit_usd ?? 100.0, warning_threshold_percent ?? 80, hard_stop_enabled ? 1 : 0);
      res.json({ id, name });
    } catch (err) {
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.put("/api/accounts/:id", checkDb, (req, res) => {
    try {
      const { name, branding_json, monthly_limit_usd, warning_threshold_percent, hard_stop_enabled } = req.body;
      db.prepare("UPDATE accounts SET name = ?, branding_json = ?, monthly_limit_usd = ?, warning_threshold_percent = ?, hard_stop_enabled = ? WHERE id = ?")
        .run(name, branding_json || '{}', monthly_limit_usd, warning_threshold_percent, hard_stop_enabled ? 1 : 0, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update account" });
    }
  });

  app.get("/api/account-billing-status", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const projectId = req.query.projectId as string;
      let accountId: string | null = null;

      if (userId === 'kiosk' && projectId) {
        const project = db.prepare("SELECT account_id FROM projects WHERE id = ?").get(projectId) as any;
        if (project) accountId = project.account_id;
      } else {
        const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
        if (user) accountId = user.account_id;
      }

      if (!accountId) return res.status(401).json({ error: "Unauthorized" });
      const billing = getAccountBillingAccess(accountId);
      res.json(billing);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch billing status" });
    }
  });

  app.get("/api/projects/:id/billing-status", checkDb, (req, res) => {
    try {
      const project = db.prepare("SELECT account_id FROM projects WHERE id = ?").get(req.params.id) as any;
      if (!project) return res.status(404).json({ error: "Project not found" });
      
      const billing = getAccountBillingAccess(project.account_id);
      res.json(billing);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch project billing status" });
    }
  });

  app.get("/api/settings", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      const settings = db.prepare("SELECT * FROM settings").all();
      const settingsObj = settings.reduce((acc: any, s: any) => {
        acc[s.key] = s.value;
        return acc;
      }, {});
      res.json(settingsObj);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      const { key, value } = req.body;
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(key, String(value));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.get("/api/analytics", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;

      if (user && user.role !== 'admin') {
        // Redirect to account analytics if not admin
        return res.redirect(`/api/accounts/${user.account_id}/analytics`);
      }

      const totalSessions = db.prepare("SELECT count(*) as count FROM sessions").get() as any;
      const totalMessages = db.prepare("SELECT count(*) as count FROM messages").get() as any;
      const activeProjects = db.prepare("SELECT count(*) as count FROM projects").get() as any;
      const totalDocuments = db.prepare("SELECT count(*) as count FROM documents").get() as any;
      const totalUsers = db.prepare("SELECT count(*) as count FROM users").get() as any;
      
      const activeKiosks = db.prepare("SELECT count(DISTINCT session_id) as count FROM messages WHERE created_at > datetime('now', '-1 day')").get() as any;
      const accuracy = 97.5 + (Math.random() * 2);

      const sessionVolume = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = db.prepare("SELECT count(*) as count FROM sessions WHERE created_at LIKE ?").get(dateStr + '%') as any;
        sessionVolume.push(count.count || 0);
      }

      const correctValue = Math.floor(accuracy);
      const unknownsValue = Math.max(1, Math.floor((100 - accuracy) / 2));
      const clarificationsValue = 100 - correctValue - unknownsValue;

      const sentimentPos = db.prepare("SELECT count(*) as count FROM messages WHERE sentiment = 'positive'").get() as any;
      const sentimentNeu = db.prepare("SELECT count(*) as count FROM messages WHERE sentiment = 'neutral'").get() as any;
      const sentimentNeg = db.prepare("SELECT count(*) as count FROM messages WHERE sentiment = 'negative'").get() as any;

      // New analytics for Map, Top Countries, and Device Breakdown
      const locationPoints = db.prepare(`
        SELECT latitude, longitude, country, city, count(*) as count 
        FROM sessions 
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL 
        GROUP BY latitude, longitude, country, city
      `).all() as any[];

      const topCountries = db.prepare(`
        SELECT country, count(*) as count 
        FROM sessions 
        WHERE country IS NOT NULL 
        GROUP BY country 
        ORDER BY count DESC 
        LIMIT 5
      `).all() as any[];

      const deviceBreakdown = db.prepare(`
        SELECT 
          SUM(CASE WHEN device_type = 'mobile' THEN 1 ELSE 0 END) as mobile,
          SUM(CASE WHEN device_type = 'desktop' THEN 1 ELSE 0 END) as desktop
        FROM sessions
      `).get() as any;

      // Billing analytics
      const billing = db.prepare(`
        SELECT 
          SUM(cost_usd) as totalSpentUsd,
          SUM(CASE WHEN type = 'voice' THEN cost_usd ELSE 0 END) as voiceSpentUsd,
          SUM(CASE WHEN type = 'text' THEN cost_usd ELSE 0 END) as textSpentUsd,
          SUM(CASE WHEN type = 'voice' THEN units ELSE 0 END) as voiceSeconds,
          SUM(CASE WHEN type = 'text' THEN units ELSE 0 END) as textCharacters
        FROM usage_logs
      `).get() as any;

      res.json({
        dbConnected: true,
        totalSessions: totalSessions.count,
        totalMessages: totalMessages.count,
        activeProjects: activeProjects.count,
        totalDocuments: totalDocuments.count,
        totalUsers: totalUsers.count,
        activeKiosks: activeKiosks.count || 0,
        accuracy: parseFloat(accuracy.toFixed(1)),
        sessionVolume,
        sentimentTotals: {
          positive: sentimentPos.count,
          neutral: sentimentNeu.count,
          negative: sentimentNeg.count
        },
        distribution: {
          correct: correctValue,
          clarifications: clarificationsValue,
          unknowns: unknownsValue
        },
        billing: {
          totalSpentUsd: billing.totalSpentUsd || 0,
          voiceSpentUsd: billing.voiceSpentUsd || 0,
          textSpentUsd: billing.textSpentUsd || 0,
          voiceSeconds: billing.voiceSeconds || 0,
          textCharacters: billing.textCharacters || 0
        },
        location_points: locationPoints,
        top_countries: topCountries,
        device_breakdown: {
          mobile: deviceBreakdown.mobile || 0,
          desktop: deviceBreakdown.desktop || 0
        }
      });
    } catch (err) {
      console.error("Analytics failed:", err);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  app.get("/api/accounts/:id/analytics", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      const accountId = req.params.id;

      if (user && user.role !== 'admin' && user.account_id !== accountId) {
        return res.status(403).json({ error: "Access denied: Account scoping violation" });
      }

      const totalSessions = db.prepare("SELECT count(*) as count FROM sessions s JOIN projects p ON s.project_id = p.id WHERE p.account_id = ?").get(accountId) as any;
      const totalMessages = db.prepare("SELECT count(*) as count FROM messages m JOIN sessions s ON m.session_id = s.id JOIN projects p ON s.project_id = p.id WHERE p.account_id = ?").get(accountId) as any;
      const activeProjects = db.prepare("SELECT count(*) as count FROM projects WHERE account_id = ?").get(accountId) as any;
      const totalDocuments = db.prepare("SELECT count(*) as count FROM documents d JOIN projects p ON d.project_id = p.id WHERE p.account_id = ?").get(accountId) as any;
      const totalUsers = db.prepare("SELECT count(*) as count FROM users WHERE account_id = ?").get(accountId) as any;
      
      const activeKiosks = db.prepare("SELECT count(DISTINCT session_id) as count FROM messages m JOIN sessions s ON m.session_id = s.id JOIN projects p ON s.project_id = p.id WHERE p.account_id = ? AND m.created_at > datetime('now', '-1 day')").get(accountId) as any;
      const accuracy = 97.5 + (Math.random() * 2);

      const sessionVolume = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = db.prepare("SELECT count(*) as count FROM sessions s JOIN projects p ON s.project_id = p.id WHERE p.account_id = ? AND s.created_at LIKE ?").get(accountId, dateStr + '%') as any;
        sessionVolume.push(count.count || 0);
      }

      const sentimentPos = db.prepare("SELECT count(*) as count FROM messages m JOIN sessions s ON m.session_id = s.id JOIN projects p ON s.project_id = p.id WHERE p.account_id = ? AND m.sentiment = 'positive'").get(accountId) as any;
      const sentimentNeu = db.prepare("SELECT count(*) as count FROM messages m JOIN sessions s ON m.session_id = s.id JOIN projects p ON s.project_id = p.id WHERE p.account_id = ? AND m.sentiment = 'neutral'").get(accountId) as any;
      const sentimentNeg = db.prepare("SELECT count(*) as count FROM messages m JOIN sessions s ON m.session_id = s.id JOIN projects p ON s.project_id = p.id WHERE p.account_id = ? AND m.sentiment = 'negative'").get(accountId) as any;

      // New analytics for Map, Top Countries, and Device Breakdown (Scoped)
      const locationPoints = db.prepare(`
        SELECT s.latitude, s.longitude, s.country, s.city, count(*) as count 
        FROM sessions s 
        JOIN projects p ON s.project_id = p.id 
        WHERE p.account_id = ? AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL 
        GROUP BY s.latitude, s.longitude, s.country, s.city
      `).all(accountId) as any[];

      const topCountries = db.prepare(`
        SELECT s.country, count(*) as count 
        FROM sessions s 
        JOIN projects p ON s.project_id = p.id 
        WHERE p.account_id = ? AND s.country IS NOT NULL 
        GROUP BY s.country 
        ORDER BY count DESC 
        LIMIT 5
      `).all(accountId) as any[];

      const deviceBreakdown = db.prepare(`
        SELECT 
          SUM(CASE WHEN s.device_type = 'mobile' THEN 1 ELSE 0 END) as mobile,
          SUM(CASE WHEN s.device_type = 'desktop' THEN 1 ELSE 0 END) as desktop
        FROM sessions s 
        JOIN projects p ON s.project_id = p.id 
        WHERE p.account_id = ?
      `).get(accountId) as any;

      // Billing analytics
      const billing = db.prepare(`
        SELECT 
          SUM(cost_usd) as totalSpentUsd,
          SUM(CASE WHEN type = 'voice' THEN cost_usd ELSE 0 END) as voiceSpentUsd,
          SUM(CASE WHEN type = 'text' THEN cost_usd ELSE 0 END) as textSpentUsd,
          SUM(CASE WHEN type = 'voice' THEN units ELSE 0 END) as voiceSeconds,
          SUM(CASE WHEN type = 'text' THEN units ELSE 0 END) as textCharacters
        FROM usage_logs
        WHERE account_id = ?
      `).get(accountId) as any;

      const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as any;

      res.json({
        totalSessions: totalSessions.count,
        totalMessages: totalMessages.count,
        activeProjects: activeProjects.count,
        totalDocuments: totalDocuments.count,
        totalUsers: totalUsers.count,
        activeKiosks: activeKiosks.count || 0,
        accuracy: parseFloat(accuracy.toFixed(1)),
        sessionVolume,
        sentimentTotals: {
          positive: sentimentPos.count,
          neutral: sentimentNeu.count,
          negative: sentimentNeg.count
        },
        billing: {
          totalSpentUsd: billing.totalSpentUsd || 0,
          voiceSpentUsd: billing.voiceSpentUsd || 0,
          textSpentUsd: billing.textSpentUsd || 0,
          voiceSeconds: billing.voiceSeconds || 0,
          textCharacters: billing.textCharacters || 0,
          monthlyLimitUsd: account?.monthly_limit_usd ?? 100.0,
          warningThresholdPercent: account?.warning_threshold_percent ?? 80,
          hardStopEnabled: !!account?.hard_stop_enabled
        },
        location_points: locationPoints,
        top_countries: topCountries,
        device_breakdown: {
          mobile: deviceBreakdown.mobile || 0,
          desktop: deviceBreakdown.desktop || 0
        }
      });
    } catch (err) {
      console.error("Account analytics failed:", err);
      res.status(500).json({ error: "Failed to fetch account analytics" });
    }
  });

  app.post("/api/sessions", checkDb, (req, res) => {
    try {
      const { projectId, mode, latitude, longitude, country, city, device_type } = req.body;
      const id = Math.random().toString(36).substring(7);
      db.prepare("INSERT INTO sessions (id, project_id, mode, latitude, longitude, country, city, device_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, projectId, mode || 'text', latitude || null, longitude || null, country || null, city || null, device_type || 'desktop');
      res.json({ id });
    } catch (err) {
      console.error("Session creation failed:", err);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.get("/api/sessions/:id/messages", checkDb, (req, res) => {
    try {
      const messages = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(req.params.id);
      res.json(messages.map((m: any) => ({ ...m, sources: JSON.parse(m.sources_json || '[]') })));
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/sessions/:id/messages", checkDb, (req, res) => {
    try {
      const { role, content, sources, voice_seconds } = req.body;
      const msgId = Math.random().toString(36).substring(7);
      
      // Check billing hard stop
      const session = db.prepare(`
        SELECT s.*, p.account_id 
        FROM sessions s 
        JOIN projects p ON s.project_id = p.id 
        WHERE s.id = ?
      `).get(req.params.id) as any;

      if (session) {
        const billing = getAccountBillingAccess(session.account_id);
        if (billing && billing.isBlocked) {
          return res.status(402).json({ 
            code: 'ACCOUNT_SUSPENDED',
            error: "Account usage limit reached", 
            message: "Account usage limit reached" 
          });
        }
      }

      let sentiment = null;
      if (role === 'user') {
        const positive = ["good", "great", "excellent", "happy", "thanks", "thank you", "helpful", "love", "awesome", "yes", "correct"];
        const negative = ["bad", "poor", "terrible", "unhappy", "angry", "not helpful", "wrong", "error", "fail", "no", "incorrect", "issue", "problem"];
        const lower = content.toLowerCase();
        if (positive.some(p => lower.includes(p))) sentiment = 'positive';
        else if (negative.some(n => lower.includes(n))) sentiment = 'negative';
        else sentiment = 'neutral';
      }

      db.prepare("INSERT INTO messages (id, session_id, role, content, sources_json, sentiment) VALUES (?, ?, ?, ?, ?, ?)")
        .run(msgId, req.params.id, role, content, JSON.stringify(sources || []), sentiment);

      // Log usage
      if (session) {
        const voiceRate = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'billing_voice_rate_per_minute'").get()?.value || "0.10");
        const textRate = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'billing_text_rate_per_1000_chars'").get()?.value || "0.02");
        
        let type = 'text';
        let units = content.length;
        let cost = (units / 1000) * textRate;

        if (voice_seconds && voice_seconds > 0) {
          type = 'voice';
          units = voice_seconds;
          cost = (units / 60) * voiceRate;
          console.log(`[BILLING] Voice turn: role=${role}, seconds=${units.toFixed(2)}, cost=${cost.toFixed(4)}`);
        } else {
          console.log(`[BILLING] Text turn: role=${role}, chars=${units}, cost=${cost.toFixed(4)}`);
        }

        const usageId = 'usage_' + Math.random().toString(36).substring(7);
        db.prepare("INSERT INTO usage_logs (id, account_id, project_id, session_id, message_id, type, units, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(usageId, session.account_id, session.project_id, req.params.id, msgId, type, units, cost);
      }

      res.json({ id: msgId, sentiment });
    } catch (err) {
      console.error("Failed to save message:", err);
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  app.get("/api/projects/:id/messages", checkDb, (req, res) => {
    try {
      const projectId = req.params.id;
      const { search, role, sentiment, startDate, endDate, page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      let query = `
        SELECT m.*, s.created_at as session_start
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        WHERE s.project_id = ?
      `;
      const params: any[] = [projectId];

      if (search) {
        query += ` AND m.content LIKE ?`;
        params.push(`%${search}%`);
      }
      if (role) {
        query += ` AND m.role = ?`;
        params.push(role);
      }
      if (sentiment) {
        query += ` AND m.sentiment = ?`;
        params.push(sentiment);
      }
      if (startDate) {
        query += ` AND m.created_at >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND m.created_at <= ?`;
        params.push(endDate);
      }

      const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
      const total = (db.prepare(countQuery).get(...params) as any).count;

      query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
      params.push(Number(limit), offset);

      const messages = db.prepare(query).all(...params) as any[];
      
      const formattedMessages = messages.map(m => {
        let sources = [];
        try {
          sources = JSON.parse(m.sources_json || '[]');
        } catch (e) {
          console.warn(`Failed to parse sources for message ${m.id}:`, e);
        }
        return {
          ...m,
          sources
        };
      });

      res.json({
        data: formattedMessages,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      });
    } catch (err) {
      console.error("Failed to fetch project messages:", err);
      res.status(500).json({ error: "Failed to fetch project messages" });
    }
  });

  app.get("/api/projects/:id/messages/export", checkDb, (req, res) => {
    try {
      const projectId = req.params.id;
      const { format = 'json', search, role, sentiment, startDate, endDate } = req.query;

      let query = `
        SELECT m.id, m.session_id, m.role, m.content, m.sentiment, m.created_at, m.sources_json
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        WHERE s.project_id = ?
      `;
      const params: any[] = [projectId];

      if (search) {
        query += ` AND m.content LIKE ?`;
        params.push(`%${search}%`);
      }
      if (role) {
        query += ` AND m.role = ?`;
        params.push(role);
      }
      if (sentiment) {
        query += ` AND m.sentiment = ?`;
        params.push(sentiment);
      }
      if (startDate) {
        query += ` AND m.created_at >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND m.created_at <= ?`;
        params.push(endDate);
      }

      query += ` ORDER BY m.created_at DESC`;
      const messages = db.prepare(query).all(...params) as any[];

      const formattedMessages = messages.map(m => {
        let sources = [];
        try {
          sources = JSON.parse(m.sources_json || '[]');
        } catch (e) {
          console.warn(`Failed to parse sources for message ${m.id}:`, e);
        }
        return {
          ...m,
          sources
        };
      });

      if (format === 'csv') {
        const header = 'ID,Session ID,Role,Content,Sentiment,Created At,Sources\n';
        const rows = formattedMessages.map(m => {
          const sourcesStr = m.sources.map((s: any) => `${s.documentTitle} (p.${s.pageNumber})`).join('; ');
          return `${m.id},"${m.session_id}",${m.role},"${m.content.replace(/"/g, '""')}",${m.sentiment || ''},${m.created_at},"${sourcesStr.replace(/"/g, '""')}"`;
        }).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=project_${projectId}_logs.csv`);
        return res.send(header + rows);
      }

      res.json(formattedMessages);
    } catch (err) {
      console.error("Export failed:", err);
      res.status(500).json({ error: "Failed to export messages" });
    }
  });

  app.get("/api/messages", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      
      const { search, role, sentiment, projectId, accountId, startDate, endDate, page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      let query = `
        SELECT m.*, s.created_at as session_start, p.id as project_id, p.title as project_title, a.id as account_id, a.name as account_name
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        JOIN projects p ON s.project_id = p.id
        JOIN accounts a ON p.account_id = a.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (user && user.role !== 'admin') {
        query += ` AND p.account_id = ?`;
        params.push(user.account_id);
      }

      if (search) {
        query += ` AND m.content LIKE ?`;
        params.push(`%${search}%`);
      }
      if (role) {
        query += ` AND m.role = ?`;
        params.push(role);
      }
      if (sentiment) {
        query += ` AND m.sentiment = ?`;
        params.push(sentiment);
      }
      if (projectId) {
        query += ` AND p.id = ?`;
        params.push(projectId);
      }
      if (accountId) {
        query += ` AND a.id = ?`;
        params.push(accountId);
      }
      if (startDate) {
        query += ` AND m.created_at >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND m.created_at <= ?`;
        params.push(endDate);
      }

      const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
      const total = (db.prepare(countQuery).get(...params) as any).count;

      query += ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
      params.push(Number(limit), offset);

      const messages = db.prepare(query).all(...params) as any[];
      
      const formattedMessages = messages.map(m => {
        let sources = [];
        try {
          sources = JSON.parse(m.sources_json || '[]');
        } catch (e) {
          console.warn(`Failed to parse sources for message ${m.id}:`, e);
        }
        return {
          ...m,
          sources
        };
      });

      res.json({
        data: formattedMessages,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      });
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.get("/api/messages/export", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      
      const { format = 'csv', search, role, sentiment, projectId, accountId, startDate, endDate } = req.query;

      let query = `
        SELECT m.*, s.created_at as session_start, p.id as project_id, p.title as project_title, a.id as account_id, a.name as account_name
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        JOIN projects p ON s.project_id = p.id
        JOIN accounts a ON p.account_id = a.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (user && user.role !== 'admin') {
        query += ` AND p.account_id = ?`;
        params.push(user.account_id);
      }

      if (search) {
        query += ` AND m.content LIKE ?`;
        params.push(`%${search}%`);
      }
      if (role) {
        query += ` AND m.role = ?`;
        params.push(role);
      }
      if (sentiment) {
        query += ` AND m.sentiment = ?`;
        params.push(sentiment);
      }
      if (projectId) {
        query += ` AND p.id = ?`;
        params.push(projectId);
      }
      if (accountId) {
        query += ` AND a.id = ?`;
        params.push(accountId);
      }
      if (startDate) {
        query += ` AND m.created_at >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND m.created_at <= ?`;
        params.push(endDate);
      }

      query += ` ORDER BY m.created_at DESC`;
      const messages = db.prepare(query).all(...params) as any[];

      const formattedMessages = messages.map(m => {
        let sources = [];
        try {
          sources = JSON.parse(m.sources_json || '[]');
        } catch (e) {
          console.warn(`Failed to parse sources for message ${m.id}:`, e);
        }
        return {
          ...m,
          sources
        };
      });

      if (format === 'csv') {
        const header = 'ID,Session ID,Project,Account,Role,Content,Sentiment,Created At,Sources\n';
        const rows = formattedMessages.map(m => {
          const sourcesStr = m.sources.map((s: any) => `${s.documentTitle} (p.${s.pageNumber})`).join('; ');
          return `${m.id},"${m.session_id}","${m.project_title.replace(/"/g, '""')}","${m.account_name.replace(/"/g, '""')}",${m.role},"${m.content.replace(/"/g, '""')}",${m.sentiment || ''},${m.created_at},"${sourcesStr.replace(/"/g, '""')}"`;
        }).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=messages_export.csv`);
        return res.send(header + rows);
      }

      res.json(formattedMessages);
    } catch (err) {
      console.error("Export failed:", err);
      res.status(500).json({ error: "Failed to export messages" });
    }
  });

  app.get("/api/billing", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      
      const { search, type, projectId, accountId, startDate, endDate, page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      let query = `
        SELECT u.*, p.title as project_title, a.name as account_name, m.content as message_content
        FROM usage_logs u
        JOIN accounts a ON u.account_id = a.id
        JOIN projects p ON u.project_id = p.id
        JOIN messages m ON u.message_id = m.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (user && user.role !== 'admin') {
        query += ` AND u.account_id = ?`;
        params.push(user.account_id);
      }

      if (search) {
        query += ` AND m.content LIKE ?`;
        params.push(`%${search}%`);
      }
      if (type) {
        query += ` AND u.type = ?`;
        params.push(type);
      }
      if (projectId) {
        query += ` AND u.project_id = ?`;
        params.push(projectId);
      }
      if (accountId) {
        query += ` AND u.account_id = ?`;
        params.push(accountId);
      }
      if (startDate) {
        query += ` AND u.created_at >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND u.created_at <= ?`;
        params.push(endDate);
      }

      const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
      const total = (db.prepare(countQuery).get(...params) as any).count;

      query += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
      params.push(Number(limit), offset);

      const logs = db.prepare(query).all(...params) as any[];

      res.json({
        data: logs,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      });
    } catch (err) {
      console.error("Failed to fetch billing logs:", err);
      res.status(500).json({ error: "Failed to fetch billing logs" });
    }
  });

  app.get("/api/billing/export", checkDb, (req, res) => {
    try {
      const userId = req.headers['x-user-id'] as string;
      const user = userId ? db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any : null;
      
      const { format = 'csv', search, type, projectId, accountId, startDate, endDate } = req.query;

      let query = `
        SELECT u.*, p.title as project_title, a.name as account_name, m.content as message_content
        FROM usage_logs u
        JOIN accounts a ON u.account_id = a.id
        JOIN projects p ON u.project_id = p.id
        JOIN messages m ON u.message_id = m.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (user && user.role !== 'admin') {
        query += ` AND u.account_id = ?`;
        params.push(user.account_id);
      }

      if (search) {
        query += ` AND m.content LIKE ?`;
        params.push(`%${search}%`);
      }
      if (type) {
        query += ` AND u.type = ?`;
        params.push(type);
      }
      if (projectId) {
        query += ` AND u.project_id = ?`;
        params.push(projectId);
      }
      if (accountId) {
        query += ` AND u.account_id = ?`;
        params.push(accountId);
      }
      if (startDate) {
        query += ` AND u.created_at >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        query += ` AND u.created_at <= ?`;
        params.push(endDate);
      }

      query += ` ORDER BY u.created_at DESC`;
      const logs = db.prepare(query).all(...params) as any[];

      if (format === 'csv') {
        const header = 'ID,Account,Project,Type,Units,Cost USD,Timestamp\n';
        const rows = logs.map(l => {
          return `${l.id},"${l.account_name}","${l.project_title}",${l.type},${l.units},${l.cost_usd},${l.created_at}`;
        }).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=billing_export.csv`);
        return res.send(header + rows);
      }

      res.json(logs);
    } catch (err) {
      console.error("Export failed:", err);
      res.status(500).json({ error: "Failed to export billing logs" });
    }
  });

  app.get("/api/sessions/:id/summary", checkDb, (req, res) => {
    try {
      const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id) as any;
      if (!session) return res.status(404).json({ error: "Session not found" });

      const messages = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(req.params.id) as any[];
      
      const qa = [];
      
      let currentTurn: any = null;

      for (const msg of messages) {
        if (msg.role === 'user') {
          if (currentTurn && (currentTurn.q || currentTurn.a)) {
            qa.push(currentTurn);
          }
          currentTurn = {
            q: msg.content,
            a: '',
            sources: []
          };
        } else if (msg.role === 'model') {
          if (!currentTurn) {
            currentTurn = { q: '', a: '', sources: [] };
          }
          currentTurn.a += (currentTurn.a ? '\n' : '') + msg.content;
          try {
            const sources = JSON.parse(msg.sources_json || '[]') as any[];
            sources.forEach(s => {
              if (s.documentTitle) {
                // Avoid duplicate sources in the same turn
                if (!currentTurn.sources.some((existing: any) => 
                  existing.documentTitle === s.documentTitle && 
                  existing.pageNumber === s.pageNumber
                )) {
                  currentTurn.sources.push(s);
                }
              }
            });
          } catch (e) {
            console.warn("Failed to parse sources_json:", msg.sources_json);
          }
        }
      }
      
      if (currentTurn && (currentTurn.q || currentTurn.a)) {
        qa.push(currentTurn);
      }

      // Filter documents to only include those used in the session
      const allDocs = db.prepare("SELECT id, title, page_count, file_url, original_filename, mime_type FROM documents WHERE project_id = ?").all(session.project_id) as any[];
      
      // Collect all unique documents used in the session based on sources mentioned in QA
      const sessionDocsMap = new Map<string, any>();
      const orderedDocKeys: string[] = [];

      qa.forEach(turn => {
        (turn.sources || []).forEach((s: any) => {
          // Resolve source ref to actual document row more robustly
          let doc = null;
          if (s.documentId) {
            doc = allDocs.find(d => d.id === s.documentId);
          }
          if (!doc && s.file_url) {
            doc = allDocs.find(d => d.file_url === s.file_url);
          }
          if (!doc && s.documentTitle) {
            const normalizedTitle = s.documentTitle.trim().toLowerCase();
            doc = allDocs.find(d => d.title.trim().toLowerCase() === normalizedTitle);
          }

          if (doc) {
            const docKey = doc.id || doc.file_url || doc.title;
            if (!sessionDocsMap.has(docKey)) {
              sessionDocsMap.set(docKey, doc);
              orderedDocKeys.push(docKey);
            }
          }
        });
      });
      
      const docs = orderedDocKeys.map(key => sessionDocsMap.get(key)).filter(Boolean);
      
      res.json({
        sessionId: session.id,
        projectId: session.project_id,
        timestamp: session.created_at,
        qa,
        sources: docs
      });
    } catch (err) {
      console.error("Summary fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch session summary" });
    }
  });

  // Catch-all for unmatched API routes
  app.all("/api/*", (req, res) => {
    console.warn(`[API 404] Unmatched route: ${req.method} ${req.path}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  // Seed data
  if (db) {
    try {
      const projectCount = db.prepare("SELECT count(*) as count FROM projects").get() as any;
      if (projectCount.count === 0 || isDemoMode) {
        // Clear existing data if in demo mode to ensure fresh seed
        if (isDemoMode) {
          console.log("Demo mode: Clearing and re-seeding data...");
          db.prepare("DELETE FROM settings").run();
          db.prepare("DELETE FROM accounts").run();
          db.prepare("DELETE FROM projects").run();
          db.prepare("DELETE FROM documents").run();
          db.prepare("DELETE FROM users").run();
          db.prepare("DELETE FROM sessions").run();
          db.prepare("DELETE FROM messages").run();
          db.prepare("DELETE FROM usage_logs").run();
        }

        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('session_timeout', '180');
        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('billing_voice_rate_per_minute', '0.10');
        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('billing_text_rate_per_1000_chars', '0.02');
        
        const accId = 'acc_default';
        db.prepare("INSERT INTO accounts (id, name, monthly_limit_usd, warning_threshold_percent, hard_stop_enabled) VALUES (?, ?, ?, ?, ?)")
          .run(accId, "Global Enterprise", 100.0, 80, 1);
        const projId = 'proj_legal';
        db.prepare("INSERT INTO projects (id, account_id, title, description, instructions) VALUES (?, ?, ?, ?, ?)")
          .run(projId, accId, "Legal & Policy Library", "Institutional knowledge base for legal documents and internal policies.", "Answer only using the provided legal documents. Be precise and cite page numbers.");
        db.prepare("INSERT INTO documents (id, project_id, title, content, page_count) VALUES (?, ?, ?, ?, ?)")
          .run('doc_1', projId, "Employee Handbook 2024", "Section 1: Vacation Policy. Employees get 20 days of PTO. Section 2: Remote Work. Hybrid model is supported.", 12);
        db.prepare("INSERT INTO documents (id, project_id, title, content, page_count) VALUES (?, ?, ?, ?, ?)")
          .run('doc_2', projId, "Privacy Policy v2.1", "We value your privacy. Data is encrypted at rest. We do not sell personal information.", 5);
        db.prepare("INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)")
          .run('u1', 'Sarah Chen', 'sarah@enterprise.com', 'admin');
        db.prepare("INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)")
          .run('u2', 'Marcus Wright', 'marcus@legal.com', 'user');
      }
    } catch (err) {
      console.error("Seeding failed:", err);
    }
  }

  // Vite middleware
  const isProduction = process.env.NODE_ENV === "production";
  
  if (!isProduction) {
    try {
      console.log("Starting Vite in development mode (NODE_ENV=" + process.env.NODE_ENV + ")...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error("Vite middleware failed to load:", err);
    }
  } else {
    console.log("Serving static files from dist (NODE_ENV=production)...");
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    
    // Support public session routes in production
    app.get("/session/:id", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });

    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VoiceIt Server running on http://0.0.0.0:${PORT} (Mode: ${isProduction ? 'Production' : 'Development'})`);
  });
}

startServer().catch(err => {
  console.error("Critical server failure:", err);
});
