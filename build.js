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
            'content_scripts',
            'icons',
            'img',
            'models',
            'popup'
        ];

        const chromeOnlyFiles = [
            'offscreen'
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

        // 4. Copy Chrome-only files
        for (const file of chromeOnlyFiles) {
            const src = path.join(__dirname, file);
            if (await fs.pathExists(src)) {
                await fs.copy(src, path.join(chromeDir, file));
            }
        }
        console.log('Copied Chrome-only files.');

        // 5. Copy the original background.js to Chrome
        await fs.copy(path.join(__dirname, 'background.js'), path.join(chromeDir, 'background.js'));
        console.log('Copied original background.js to Chrome.');

        // 6. Copy node_modules dependencies
        const nodeModulesToCopy = ['@mediapipe/tasks-vision'];
        for (const mod of nodeModulesToCopy) {
            const src = path.join(__dirname, 'node_modules', mod);
            if (await fs.pathExists(src)) {
                await fs.copy(src, path.join(chromeDir, 'node_modules', mod));
                await fs.copy(src, path.join(firefoxDir, 'node_modules', mod));
            }
        }
        console.log('Copied node_modules dependencies.');

        // 7. Create browser-specific manifests
        const manifest = await fs.readJson(path.join(__dirname, 'manifest.json'));

        // Chrome manifest (no changes needed from source)
        await fs.writeJson(path.join(chromeDir, 'manifest.json'), manifest, { spaces: 2 });
        console.log('Created Chrome manifest.');

        // Firefox manifest
        const firefoxManifest = { ...manifest };
        
        // Remove 'offscreen' permission for Firefox as it's not supported
        if (firefoxManifest.permissions) {
            firefoxManifest.permissions = firefoxManifest.permissions.filter(p => p !== 'offscreen');
        }
        
        // Change background script format for Firefox
        firefoxManifest.background = {
            scripts: [manifest.background.service_worker]
        };
        
        // Add Firefox-specific settings
        firefoxManifest.browser_specific_settings = {
            gecko: {
                id: '{974d3744-32f3-4d44-a8e7-9231a423bdb3}',
                strict_min_version: '134.0'
            }
        };

        // Update web_accessible_resources to include .mjs files for Firefox
        if (firefoxManifest.web_accessible_resources) {
            firefoxManifest.web_accessible_resources = firefoxManifest.web_accessible_resources.map(resource => {
                if (resource.resources.includes('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs')) {
                    // Add .mjs for Firefox ES module support
                    return {
                        ...resource,
                        resources: [
                            ...resource.resources,
                            'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'
                        ]
                    };
                }
                return resource;
            });
        }

        // Update content security policy for Firefox
        firefoxManifest.content_security_policy = {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src https://*.ytimg.com https://*.vk.com https://*.vkvideo.ru https://*.userapi.com https://*.mycdn.me data:;"
        };

        await fs.writeJson(path.join(firefoxDir, 'manifest.json'), firefoxManifest, { spaces: 2 });
        console.log('Created Firefox manifest.');

        // 8. Create Firefox-specific background.js
        await createFirefoxBackground();
        console.log('Created Firefox-specific background.js.');

        console.log('Build completed successfully!');
        console.log('Chrome build: ./dist/chrome/');
        console.log('Firefox build: ./dist/firefox/');

    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

async function createFirefoxBackground() {
    const originalBackground = await fs.readFile(path.join(__dirname, 'background.js'), 'utf-8');
    
    // Create a modified version for Firefox
    const firefoxBackground = originalBackground
        .replace(
            /const isChrome = !!self\.chrome\?\.offscreen;/,
            'const isChrome = false; // Force Firefox mode'
        )
        .replace(
            /\/\/ --- Firefox Worker ---[\s\S]*?\/\/ A mapping from a job ID to the tab that it belongs to\./,
            `// --- Firefox Direct Processing ---
let faceDetector = null;
let isDetectorReady = false;
let isInitializingDetector = false;

// A mapping from a job ID to the tab that it belongs to.`
        );

    await fs.writeFile(path.join(firefoxDir, 'background.js'), firefoxBackground);
}

build();