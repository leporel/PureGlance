const fs = require('fs-extra');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const chromeDir = path.join(distDir, 'chrome');
const firefoxDir = path.join(distDir, 'firefox');

async function build() {
    try {
        // 1. Clean and create dist directories
        await fs.emptyDir(distDir);
        await fs.ensureDir(chromeDir);
        await fs.ensureDir(firefoxDir);
        console.log('Created clean dist directories.');

        // 2. Define files and directories to copy
        const commonFiles = [
            'background.js',
            'content_scripts',
            'icons',
            'img',
            'models',
            'offscreen',
            'popup'
        ];

        // 3. Copy common files to both chrome and firefox directories
        for (const file of commonFiles) {
            const src = path.join(__dirname, file);
            if (await fs.pathExists(src)) {
                await fs.copy(src, path.join(chromeDir, file));
                await fs.copy(src, path.join(firefoxDir, file));
            }
        }
        console.log('Copied common files.');

        // 4. Copy node_modules dependencies
        const nodeModulesToCopy = ['@mediapipe/tasks-vision'];
        for (const mod of nodeModulesToCopy) {
            const src = path.join(__dirname, 'node_modules', mod);
            if (await fs.pathExists(src)) {
                await fs.copy(src, path.join(chromeDir, 'node_modules', mod));
                await fs.copy(src, path.join(firefoxDir, 'node_modules', mod));
            }
        }
        console.log('Copied node_modules dependencies.');

        // 5. Create browser-specific manifests
        const manifest = await fs.readJson(path.join(__dirname, 'manifest.json'));

        // Chrome manifest (no changes needed from source)
        await fs.writeJson(path.join(chromeDir, 'manifest.json'), manifest, { spaces: 2 });
        console.log('Created Chrome manifest.');

        // Firefox manifest
        const firefoxManifest = { ...manifest };
        firefoxManifest.background = {
            scripts: [manifest.background.service_worker]
        };
        firefoxManifest.browser_specific_settings = {
            gecko: {
                id: '{974d3744-32f3-4d44-a8e7-9231a423bdb3}',
                strict_min_version: '134.0'
            }
        };
        await fs.writeJson(path.join(firefoxDir, 'manifest.json'), firefoxManifest, { spaces: 2 });
        console.log('Created Firefox manifest.');

        console.log('Build completed successfully!');

    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build(); 