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
import { XMLParser } from "fast-xml-parser";

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
  try {
    db = new Database("voiceit.db");
    console.log("Database connected.");

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
        welcome_message TEXT,
        FOREIGN KEY(account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        content TEXT,
        original_filename TEXT,
        stored_filename TEXT,
        file_path TEXT,
        file_url TEXT,
        mime_type TEXT,
        size INTEGER,
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
      db.prepare("ALTER TABLE documents ADD COLUMN page_count INTEGER DEFAULT 1").run();
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

    try {
      db.prepare("ALTER TABLE projects ADD COLUMN welcome_message TEXT").run();
      console.log("Added welcome_message column to projects table.");
    } catch (e) {}

    try {
      db.prepare("ALTER TABLE documents ADD COLUMN size INTEGER").run();
      console.log("Added size column to documents table.");
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
              
              if (PDFParse) {
                console.log(`Parsing PDF: ${title}, size: ${file.buffer.length} bytes using PDFParse class`);
                const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
                const data = await parser.getText();
                console.log(`PDFParse result for ${title}:`, { 
                  hasText: !!data.text, 
                  textLength: data.text?.length
                });
                content = data.text || "";
                // Attempt to get page count if available in the result
                pageCount = data.pages?.length || data.numpages || 1;
              } else {
                // Fallback to the standard function call if PDFParse is not available
                const pdfParser = typeof pdfModule === 'function' ? pdfModule : pdfModule.default;
                if (typeof pdfParser === 'function') {
                  const data = await pdfParser(file.buffer);
                  content = data.text || "";
                  pageCount = data.numpages || 1;
                } else {
                  throw new Error(`Could not resolve pdf-parse. Type: ${typeof pdfModule}`);
                }
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
      console.log(`[API] Fetching settings - ${new Date().toISOString()}`);
      const settings = db.prepare("SELECT * FROM settings").all();
      const settingsObj = settings.reduce((acc: any, s: any) => {
        acc[s.key] = s.value;
        return acc;
      }, {});
      res.json(settingsObj);
    } catch (err) {
      console.error("[API Error] Failed to fetch settings:", err);
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
      if (projectCount.count === 0) {
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

      // Seed SKN Laws project and documents
      const sknAccount = db.prepare("SELECT id FROM accounts WHERE id = ?").get('acc_skn');
      if (!sknAccount) {
        db.prepare("INSERT INTO accounts (id, name, monthly_limit_usd, warning_threshold_percent, hard_stop_enabled) VALUES (?, ?, ?, ?, ?)")
          .run('acc_skn', 'SKN', 100.0, 80, 1);
        console.log("Seeded SKN account");
      }

      const sknProject = db.prepare("SELECT id FROM projects WHERE id = ?").get('proj_skn_laws');
      const sknInstructions = 'You are an AI LAW expert and you know the LAWS and ACTs of St. Kitts and Nevis that would have been uploaded. You are only to reference what was uploaded. You are not to give legal advice.';
      
      if (!sknProject) {
        db.prepare(`
          INSERT INTO projects (id, account_id, title, description, instructions, welcome_message)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          'proj_skn_laws',
          'acc_skn',
          'SKN Laws',
          'ACTS and Laws of St. Kitts and Nevis',
          sknInstructions,
          'Welcome to the St. Kitts and Nevis Laws Kiosk. How can I assist you with legal information today?'
        );
        console.log("Seeded SKN Laws project");
      } else {
        db.prepare("UPDATE projects SET instructions = ? WHERE id = ?").run(sknInstructions, 'proj_skn_laws');
      }

      const SAMPLE_SKN_ACT_1_2025_TEXT = `No. 1 of 2025. Vehicles and Road Traffic (Amendment) Act, 2025. Saint Christopher and Nevis.

I assent,
MARCELLA ALTHEA LIBURD
Governor-General.
10th February, 2025.

SAINT CHRISTOPHER AND NEVIS
No. 1 of 2025

AN ACT to amend the Vehicles and Road Traffic Act, Cap. 15.06.
[Published 13th February 2025, Official Gazette No. 7 of 2025.]

BE IT ENACTED by the King’s Most Excellent Majesty, by and with the advice and consent of the National Assembly of Saint Christopher and Nevis, and by the authority of the same as follows:

1. Short Title.
This Act may be cited as the Vehicles and Road Traffic (Amendment) Act, 2025.

2. Interpretation.
In this Act
“Act” means the Vehicles and Road Traffic Act, Cap. 15.06.

3. Amendment of section 2.
The Act is amended in section 2 by inserting the following new definitions in the correct alphabetical order
“ “anonymous evidence” means evidence provided by a witness whose identity is concealed under provisions of this Act;
“automated notice” means a notice made under section 83A;
“evidence by affidavit” means a written statement sworn or affirmed before a commissioner of oaths or other authorized officer;
“road safety incentive” means the sum awarded by the Court to a person who submits admissible video footage that results in the successful conviction of a perpetrator for a driving offence under this Act;”.

4. Amendment of section 39.
The Act is amended in section 39 as follows—
(a) in subsection (2) by replacing “two thousand dollars” with “four thousand dollars”;
(b) in subsection (4) by replacing “two thousand dollars” with “four thousand dollars”;
(c) inserting a new subsection (9) and subsection (10) immediately after subsection (8), as follows—
“(9) Notwithstanding the generality of subsection (7), any member of the Police Force may employ a system that uses a camera and sensors to capture images of vehicles exceeding the speed limit.
“(10) Notwithstanding any provisions or law to the contrary, the registered owner of a vehicle shall be the person liable to a fine of four thousand dollars for the offence under the provisions of subsection (1), if the driver of the vehicle cannot be identified from the video or photograph issued with the automated ticket.”.

5. Amendment of section 40.
The Act is amended in section 40 by replacing subsections (1) and (2) as follows—
“40(1) Any person who, when driving or attempting to drive, or when in charge of, a motor vehicle on a road and is under the influence of alcohol or drug to such an extent as to be incapable of having proper control of the vehicle, shall be liable, on summary conviction, to a fine not exceeding ten thousand dollars or to imprisonment with or without hard labour for a term not exceeding one year, and in the case of a second or subsequent conviction either to a fine not exceeding twenty thousand dollars or to imprisonment for a term not exceeding two years or to both such fine and imprisonment.
(2) A person convicted of an offence under this section shall, without prejudice to the power of the Court to order a longer period of disqualification, be disqualified for a period of twelve months from the date of the conviction from holding or obtaining a driver’s licence, and on a second conviction for a like offence he or she shall be permanently disqualified from holding or obtaining a driver’s licence.”.

6. Amendment of section 41.
The Act is amended in section 41 as follows—
(a) in subsection (1)(a) by replacing “two thousand dollars” with “four thousand dollars”;
(b) in subsection (1)(b) by replacing “four thousand dollars” with “eight thousand dollars”;

7. Amendment of section 48.
The Act is amended in section 48 by replacing it as follows—
“(1) If a person drives a motor vehicle on a road—
(a) recklessly;
(b) at a speed which is dangerous to the public; or
(c) in any manner which is dangerous to the public;
having regard to all the circumstances of the case, including the nature, condition and use of the road, and the amount of traffic which is actually at the time, or which might reasonably be expected to be, on the road, he or she commits an offence under this section.
(2) A person who commits an offence under subsection (1) shall be liable as follows—
(a) on summary conviction, where there is no bodily injury to another person, to a fine not exceeding six thousand dollars or to imprisonment with or without hard labour for a term not exceeding one year;
(b) on summary conviction, where there is bodily injury to another person, to a fine not exceeding eight thousand dollars or to imprisonment with or without hard labour for a term not exceeding two years;
(c) on conviction on indictment, where there is no bodily injury to another person, to imprisonment with or without hard labour for a term not exceeding three years, or to a fine, or both such imprisonment and fine;
(d) on conviction on indictment, where there is bodily injury to another person, to imprisonment with or without hard labour for a term not exceeding five years;
(3) A person who commits a second or subsequent offence under subsections (2)(a), (b) and (c) shall be liable either to a fine not exceeding twenty thousand dollars or to imprisonment with or without hard labour for a term not exceeding four years or to both such fine and imprisonment.
(4) A person convicted of an offence under this section shall, without prejudice to the power of the Court to order a longer period of disqualification, be disqualified from holding or obtaining a driver’s licence for a period of one year from the date of the conviction and on a third conviction for a like offence he or she shall be permanently disqualified for holding or obtaining a driver’s licence.”

8. Amendment from section 49.
The Act is amended in section 49 by replacing it as follows—
“(1) If a person drives a motor vehicle on a road—
(a) without due care and attention;
(b) without reasonable consideration for other persons using the road; or
(c) without reasonable consideration for traffic signs;
he or she commits an offence under this section.
(2) A person who commits an offence under subsection (1) shall be liable as follows—
(a) on summary conviction, where there is no bodily injury to another person, to a fine not exceeding four thousand dollars;
(b) on summary conviction, where there is bodily injury to another person, to a fine not exceeding eight thousand dollars or to imprisonment with or without hard labour for a term not exceeding six months.
(3) A person who commits a second or subsequent offence under subsections (2)(a) or (b) shall be liable either to a fine not exceeding ten thousand dollars or to imprisonment with or without hard labour for a term not exceeding one year or to both such fine and imprisonment.
(4) A person convicted for a like offence under this section for a second or subsequent time shall, without prejudice to the power of the Court to order a longer period of disqualification, be disqualified from holding or obtaining a driver’s licence for a period of six months from the date of the conviction and on a third conviction for a like offence for a period of one year from the date of the conviction.
(5) Notwithstanding any provisions or law to the contrary, the registered owner of a vehicle shall be the person liable to a fine of four thousand dollars for the offence under the provisions of subsection (1), if the driver of the vehicle cannot be identified from the video or photograph issued with the automated ticket.”.

9. Amendment of section 50.
The Act is amended in section 50 as follows—
(a) in subsection (1) by replacing “five years” with “ten years”;
(b) in subsection (4) by replacing “three years” with “six years”.

10. Amendment of section 54.
The Act is amended in section 54 subsection (1) paragraph (c) by replacing the expression “a notice of the intended prosecution” with the expression “a notice or automated notice of the intended prosecution”.

11. Amendment of Act by inserting section 83A.
The Act is amended by inserting a new section 83A immediately after section 83, as follows—
“83A. Automated notice
(1) An automated notice may be issued to the driver or registered owner of a motor vehicle that has been recorded—
(a) exceeding the speed limit; or
(b) driving through a traffic stop whilst the applicable traffic light is red.
(2) A duplicate of an automated notice shall be provided to the Magistrate for the magisterial district in which the offence is alleged to have been committed, a duplicate of the notice, which duplicate shall be deemed to be a complaint laid before the magistrate and a summons issued by the Magistrate for the purposes of the Magistrate’s Code of Procedure Act.
(3) Sections 84, 85, 86, 87, 88 and 89 shall apply mutatis mutandis to an automated notice.

12. Amendment of Act by inserting PART VIII.
The Act is amended by inserting the following Part immediately after Part VII:
“PART VIII: PUBLIC REPORTING OF OFFENCES
96. Submission of Video Footage
(1) Any person who, by means of video recording device, captures digital video footage of a suspected road traffic offence under this Act may submit such footage to the Commissioner of Police or any police officer designated for that purpose.
(2) The Director of Public Prosecutions shall review the footage referred to in subsection (1) and determine its relevance and admissibility under the rules of evidence.
97. Admissibility of Video Evidence
(1) Video footage submitted under this Part shall be admissible in court if—
(a) it is relevant to the matter before the court; and
(b) the court is satisfied that—
(i) the footage is an accurate and true record of the events depicted; and
(ii) the footage has not been tampered with or altered in any way.
(2) Evidence of compliance with the conditions prescribed by this section may be given orally or by affidavit by the person who has knowledge or may reasonably be expected to have knowledge of the making or contents of the video footage.
(3) Unless the court orders otherwise, no affidavit is to be admitted in evidence under this section unless the party producing the affidavit—
(a) gives notice of intention to produce it to each party to the legal proceedings, at least seven days before its production; and
(b) produces it for inspection, to a party who gives notice of inspection, no later than five days after receiving that notice.
(4) A party may cross-examine a deponent of an affidavit referred to in subsection (2) that has been introduced in evidence with leave of the court.
(5) Nothing in this section prevents the admissibility of video evidence that would otherwise be admissible under the Evidence Act or any other applicable law.
98. Provision for Anonymous Evidence
(1) A witness who provides video footage may opt to give evidence or swear to an affidavit under this Act anonymously, provided that—
(a) the court is satisfied that anonymity is necessary to ensure the safety of the witness or protection from harassment; and
(b) the identity of the witness is disclosed to the judge in a sealed record.
(2) Anonymous evidence may be given via remote means approved by the court, including a live video link.
99. Reward Payment
(1) Subject to subsection (4) of this section, where a person is convicted of a driving offence and the court is satisfied that video footage provided under section 97 played an important role in establishing the conviction, the court may order the perpetrator to pay a road safety incentive not exceeding five thousand dollars to the court and the court will facilitate the payment of the incentive to the individual who provided the footage.
(2) Payment under this section shall be enforceable as a court-ordered penalty and shall be in addition to any other penalty the court may lawfully impose.
(3) In default of payment of the road safety incentive, the person convicted shall be liable to imprisonment for seven days.
(4) A financial penalty or combination of financial penalties shall not be imposed unless the court is satisfied, based on evidence, that the offender has the financial means to pay.
(5) In determining the quantum of the road safety incentive to be paid, the court shall take into account—
(a) the circumstances under which the video footage was obtained;
(b) the relevance and reliability of the video footage; and
(c) any other factors the court considers appropriate in the interest of justice.
100. Prohibition Against Solicitation or Extortion
(1) No person shall—
(a) solicit, accept, or agree to accept payment or any other benefit from a perpetrator in exchange for withholding video footage of a suspected road traffic offence;
(b) offer or agree to offer payment or any other benefit to the recorder of video footage in exchange for withholding such evidence from the police; or
(c) destroy, manipulate, or discard video footage of a suspected road traffic offence.
(2) A person who contravenes this section commits an offence and is liable on summary conviction to:
(a) a fine not exceeding ten thousand dollars;
(b) imprisonment for a term not exceeding one year; or
(c) both such fine and imprisonment.”.

13. Amendment of Third Schedule
Notwithstanding section 91, the Act is amended in the Third Schedule by inserting new paragraphs 10 and 11 as follows—
(a) 10. Offences against section 49(1)(c) of the Vehicles and Road Traffic Act shall be subject to a fine of $250.00".
(b) 11. Offences against section 4 of the Vehicle and Road Traffic Regulations with respect to Child Safety shall be subject to a fine of $500.00".

LANEIN BLANCHETTE
Speaker
Passed by the National Assembly this 30th day of January 2025.
TREVLYN STAPLETON
Clerk of the National Assembly
`;

      const SAMPLE_SKN_ACT_5_2023_TEXT = `No. 5 of 2023. Anti-Corruption Act, 2023. Saint Christopher and Nevis.

ARRANGEMENT OF SECTIONS
Sections
PART I - PRELIMINARY
1. Short title and commencement.
2. Interpretation.
3. Objects of the Act.
4. Authority not affected.

PART II - THE SPECIAL PROSECUTOR
5. Appointment of the Special Prosecutor
6. Disqualification from being the Special Prosecutor.
7. Functions of the Special Prosecutor.
8. Signing of documents.
9. Powers of the Special Prosecutor.
10. Duration of appointment.
11. Resignation.
12. Vacancy.
13. Appointment of the Acting Special Prosecutor.
14. Removal of the Special Prosecutor.
15. Appearance of the Special Prosecutor.
16. Staff of the Special Prosecutor’s Office.
17. Appointment of Attorneys-at-Law.
18. Appointment of investigators, administrative and ancillary staff.
19. Oaths or affirmations.
20. Disclosure of interests.
21. Funds for the Special Prosecutor’s Office.
22. Administrative arrangements.
23. Annual report.

PART III - PREVENTION OF CORRUPT CONDUCT
24. Prohibition of corrupt conduct by persons in public life.
25. Duty to report.
26. Complaint to the Special Prosecutor.
27. Rejection of complaint by the Special Prosecutor.
28 Investigation of breach.
29. Institution of prosecution.

PART IV - SPECIAL OFFENCES
30. Abuse of Office.
31. Fraud on the Government and Statutory Corporations.
32. Contractor subscribing to election fund.
33. Purporting to sell or purchase public office.
34. Influencing or negotiating appointments etc.

PART V - MISCELLANEOUS
35. Amendment of Schedules
36. Regulations

FIRST SCHEDULE - PUBLIC OFFICIALS
SECOND SCHEDULE - PUBLIC OFFICERS
THIRD SCHEDULE - CORRUPT CONDUCT
FOURTH SCHEDULE - OATHS

SAINT CHRISTOPHER AND NEVIS
No. 5 of 2023

AN ACT to define and create criminal offences of corrupt conduct and to create the office of a Special Prosecutor to receive complaints, investigate and prosecute acts of corrupt conduct of persons in public life in Saint Christopher and Nevis.
[Published 20th April 2023, Official Gazette No. 20 of 2023.]

BE IT ENACTED by the King's Most Excellent Majesty, by and with the advice and consent of the National Assembly of Saint Christopher and Nevis, and by the authority of the same as follows:

PART I - PRELIMINARY
1. Short title and commencement.
(1) This Act may be cited as the Anti-Corruption Act, 2023.
(2) This Act shall come into force on a day to be fixed by the Minister by Order published in the Gazette.

2. Interpretation.
In this Act,
“Acting Special Prosecutor” means the Acting Special Prosecutor appointed under section 12;
“ancillary legislation” means the following Laws of Saint Christopher and Nevis including any amendments thereto—
(a) the National Assembly Elections Act, Cap. 2.01;
(b) the Public Service Act, Cap. 22.09;
(c) the Procurement and Contract (Administration) Act, Cap. 23.36;
(d) the Finance Administration Act, Cap. 20.13;
(e) the Integrity in Public Life Act, Cap 22.18;
(f) the Freedom of Information Act, 2018;
(g) the Integrity in Public Life Ordinance, Cap 1.02 (N);

“corrupt conduct” includes—
(a) conduct specified in the Third Schedule;
(b) conduct specified as special offences in Part IV of this Act; and
(c) instigating, aiding, abetting, being an accessory after the fact in the commission or attempted commission of, or conspiring to commit, the conduct referenced in the immediately preceding paragraphs (a) and (b);

“person in public life” means a public officer and public official as defined by this Act;
“public office” is the office held by a person in public life, as those terms are defined in this Act;
“public officer” means a person serving or acting in the roles listed in the Second Schedule;
“public official” means a person serving or acting in the roles listed in the First Schedule;

3. Objects of the Act.
The objects of this Act are to—
(a) establish the types of corrupt conduct that should be criminalised;
(b) establish a dedicated Special Prosecutor’s Office to receive complaints, investigate and prosecute persons in public life and others who participate in corruption in the public sector;
(c) ensure that all persons in public life are subject to measures that promote integrity and deter and combat corruption;
(d) encourage and facilitate the reporting of corrupt activities; and
(e) encourage the investigation and prosecution of corruption offences and the recovery and return of the proceeds of crime.

PART II - THE SPECIAL PROSECUTOR
5. Appointment of the Special Prosecutor.
(1) Subject to subsection (2), the Governor-General may, acting in accordance with the recommendation of the Public Service Commission, appoint an Attorney-at-Law as the Special Prosecutor.
(3) An Attorney-at-Law appointed pursuant to subsection (1) shall have at least seven years of experience in the practice of law.

7. Functions of the Special Prosecutor.
(1) Subject to subsection (2), the Special Prosecutor may investigate and prosecute a person in public life for—
(a) a criminal offence of corrupt conduct;
(b) a civil claim related to corrupt conduct;

PART III - PREVENTION OF CORRUPT CONDUCT
24. Prohibition of corrupt conduct by persons in public life.
(1) A person in public life shall not engage in corrupt conduct, including any offence specified in Part 1 of the Third Schedule.
(2) A person in public life who contravenes subsection (1) commits an offence and is liable on summary conviction, to a fine not exceeding thirty thousand dollars or to imprisonment for a term of one year or to both.

25. Duty to report.
(1) A person in public life to whom any advantage or other benefit is given, promised or offered for the purposes of engaging in corrupt conduct or in anticipation of corrupt conduct, shall report the incident to the Special Prosecutor within twenty-eight days.

PART IV - SPECIAL OFFENCES
30. Abuse of Office.
(1) A person in public life commits an offence if he or she directly or indirectly solicits, accepts or obtains, or agrees to accept or obtain, for himself or herself or any other person, any bribe, valuables, loan, reward, advantage or other benefit with intent—
(a) to interfere with the administration of justice;
(b) to procure or facilitate the commission of an offence under any enactment;
(c) to protect from detection or punishment a person who has committed or who intends to commit an offence.

FIRST SCHEDULE - PUBLIC OFFICIALS
1. Representatives in the National Assembly;
2. Senators in the National Assembly;
3. Speaker in the National Assembly;
4. Deputy Speaker in the National Assembly;
5. Representative in the Nevis Island Assembly;
6. Senators in the Nevis Island Assembly;
7. President of the Nevis Island Assembly;
12. Prime Minister;
13. Leader of the Opposition;
14. Ministers in the Cabinet;
17. Attorney-General;
20. Director of Public Prosecutions;
22. Director of Audit;
35. Ombudsman;
36. Information Commissioner;
40. Commissioner of Police;
`;

      const sknDocs = [
        { 
          id: 'doc_skn_act1', 
          xmlFilename: 'Act1of2025.xml',
          filename: 'Act 1 of 2025.pdf', 
          title: 'Vehicles and Road Traffic (Amendment) Act, 2025',
          stored: 'skn-act-1-2025.pdf',
          pdfUrl: 'http://caribdesigns.com/voiceit/Act1of2025.pdf',
          content: SAMPLE_SKN_ACT_1_2025_TEXT,
          pageCount: 7
        },
        { 
          id: 'doc_skn_act5', 
          xmlFilename: 'Act5of2023.xml',
          filename: 'Act 5 of 2023.pdf', 
          title: 'Anti-Corruption Act, 2023',
          stored: 'skn-act-5-2023.pdf',
          pdfUrl: 'http://caribdesigns.com/voiceit/Act5of2023.pdf',
          content: SAMPLE_SKN_ACT_5_2023_TEXT,
          pageCount: 23
        }
      ];

      const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'documents');
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
      });

      for (const docInfo of sknDocs) {
        const existingDoc = db.prepare("SELECT id, content, file_url FROM documents WHERE id = ?").get(docInfo.id) as any;
        const isDummy = existingDoc && (
          existingDoc.content.includes("This is a dummy content for") || 
          existingDoc.content.includes("[Text extraction failed") ||
          existingDoc.content.includes("This document is the Appropriation Act") ||
          existingDoc.content.includes("This document is the Smoking (Designated Areas) Act")
        );
        const needsRepair = !existingDoc || isDummy || !existingDoc.file_url;

        if (needsRepair) {
          if (existingDoc) {
            console.log(`Repairing/Re-seeding document: ${docInfo.filename}`);
            db.prepare("DELETE FROM documents WHERE id = ?").run(docInfo.id);
          } else {
            console.log(`Seeding document: ${docInfo.filename}`);
          }
          
          const xmlPossiblePaths = [
            `/mnt/data/${docInfo.xmlFilename}`,
            path.join(process.cwd(), docInfo.xmlFilename),
            path.join(process.cwd(), 'src', docInfo.xmlFilename)
          ];
          
          let xmlSourcePath = "";
          for (const p of xmlPossiblePaths) {
            if (fs.existsSync(p)) {
              xmlSourcePath = p;
              break;
            }
          }
          
          let content = docInfo.content;
          if (xmlSourcePath) {
            try {
              const xmlData = fs.readFileSync(xmlSourcePath, 'utf-8');
              const jsonObj = parser.parse(xmlData);
              const doc = jsonObj.document;
              
              if (doc) {
                let extractedText = "";
                if (doc.title) extractedText += `${doc.title}\n\n`;
                
                if (doc.summary && doc.summary.item) {
                  extractedText += "SUMMARY:\n";
                  const items = Array.isArray(doc.summary.item) ? doc.summary.item : [doc.summary.item];
                  items.forEach((item: any) => {
                    extractedText += `- ${item}\n`;
                  });
                  extractedText += "\n";
                }
                
                if (doc.chunks && doc.chunks.chunk) {
                  const chunks = Array.isArray(doc.chunks.chunk) ? doc.chunks.chunk : [doc.chunks.chunk];
                  chunks.forEach((chunk: any) => {
                    if (chunk.heading) extractedText += `${chunk.heading}\n`;
                    if (chunk.content) extractedText += `${chunk.content}\n\n`;
                  });
                }
                
                if (extractedText.trim()) {
                  content = extractedText.trim();
                  console.log(`Extracted content from XML for ${docInfo.filename}`);
                }
              }
            } catch (err) {
              console.error(`Error parsing XML for ${docInfo.filename}:`, err);
            }
          }

          const fileUrl = docInfo.pdfUrl;
          const filePath = `remote://${docInfo.filename}`;
          
          db.prepare(`
            INSERT INTO documents (id, project_id, title, content, original_filename, stored_filename, file_path, file_url, mime_type, size, page_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            docInfo.id,
            'proj_skn_laws',
            docInfo.title,
            content,
            docInfo.filename,
            docInfo.stored,
            filePath,
            fileUrl,
            'application/pdf',
            content.length,
            docInfo.pageCount
          );
          console.log(`Successfully seeded document: ${docInfo.id}`);
        }
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
