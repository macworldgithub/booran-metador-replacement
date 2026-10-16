const fs = require('fs');

let code = fs.readFileSync('D:/Hammad/booran-metador-replacement/src/modules/operations/operations.service.ts', 'utf8');

// remove PlatformSettingsDto and TemplateDto from imports
code = code.replace(/PlatformSettingsDto,\r?\n/g, '');
code = code.replace(/TemplateDto,\r?\n/g, '');

// remove saveSettings
code = code.replace(/  async saveSettings\(dto: PlatformSettingsDto,[\s\S]*?return result!\.data;\r?\n  \}\r?\n/, '');

// remove templates, saveTemplate, archiveTemplate
code = code.replace(/  async templates\(user: PortalActor,[\s\S]*?return this\.saveTemplate\(id, \{ \.\.\.current\.data, active: false \}, user\);\r?\n  \}\r?\n/, '');

fs.writeFileSync('D:/Hammad/booran-metador-replacement/src/modules/operations/operations.service.ts', code, 'utf8');
console.log('Successfully cleaned operations.service.ts');
