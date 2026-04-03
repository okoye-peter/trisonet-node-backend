import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

function walk(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (file.endsWith('.js')) {
            fixImports(fullPath);
        }
    }
}

function fixImports(file) {
    let content = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);

    // Matches 'from "./foo"' or 'import "./foo"'
    // Group 1: path, Group 2: quote
    const regex = /(from|import)\s+(['"])((\.\/|\.\.\/)[^'"]+)\2/g;

    let modified = false;
    content = content.replace(regex, (match, type, quote, importPath) => {
        let absPath = path.resolve(dir, importPath);
        let finalPath = importPath;

        // 1. If it's a directory, look for index.js
        if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
            finalPath = `${importPath.replace(/\/$/, '')}/index.js`;
            modified = true;
        }
        // 2. If it doesn't have an extension, add .js (if it's not a directory)
        else if (!importPath.endsWith('.js') && !importPath.endsWith('.mjs') && !importPath.endsWith('.cjs')) {
            // Check if adding .js exists
            if (fs.existsSync(`${absPath}.js`)) {
                finalPath = `${importPath}.js`;
                modified = true;
            }
        }

        return `${type} ${quote}${finalPath}${quote}`;
    });

    if (modified) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Fixed imports in ${path.relative(distDir, file)}`);
    }
}

console.log('Fixing ESM imports in dist/...');
if (fs.existsSync(distDir)) {
    walk(distDir);
    console.log('Done.');
} else {
    console.error('dist/ directory not found.');
    process.exit(1);
}
