import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from 'obsidian';
import {v4 as uuidv4} from 'uuid';

interface ObsidianConfluenceSyncSettings {
	confluenceHost: string;
	personalAccessToken: string;
	mapping: {[key in string]: string};
}

const DEFAULT_SETTINGS: ObsidianConfluenceSyncSettings = {
	confluenceHost: "",
	personalAccessToken: "",
	mapping: {}
}

export default class ObsidianConfluenceSync extends Plugin {
	settings: ObsidianConfluenceSyncSettings;
	regex = /---\s*uniqueId:\s*[^\n\r]*\s*---/g;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'sync-to-confluence',
			name: 'Sync contents of current page to Confluence',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					return;
				}
				const uniqueId = await this.createOrGetUniqueId(activeFile);

				// get mapping for uniqueId from mapping DS
				const confluenceLink = this.settings.mapping[uniqueId];

				if (confluenceLink && confluenceLink.length > 0) {
					new Notice('Syncing to confluence!');
					let activeFileData = await this.app.vault.read(activeFile);
					activeFileData = activeFileData.replace(this.regex, '');
					this.syncContentsToConfluence(confluenceLink, activeFileData, activeFile.basename);
				} else {
					new Notice('No confluence connection found for this page! Create a connection first.');
				}
			}
		});

		this.addCommand({
			id: 'create-confluence-connection',
			name: 'Create new Confluence connection',
			callback: async () => {
				new CreateNewConnectionModal(this.app, async (result) => {
					const activeFile = this.app.workspace.getActiveFile();
					if (!activeFile) {
						return;
					}
					const uniqueId = await this.createOrGetUniqueId(activeFile);
					this.settings.mapping[uniqueId] = result;
					this.saveSettings();
				}).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObsidianConfluenceSyncSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	createOrGetUniqueId = async (activeFile: TFile): Promise<string> => {
		// get current note id
		let uniqueId = ""
		const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;

		if (frontmatter && frontmatter.uniqueId) {
			// If the note has a uniqueID metadata, retrieve it
			uniqueId = frontmatter.uniqueId;
		} else {
			// If the note doesn't have a uniqueID metadata, generate one and add it
			uniqueId = this.generateUniqueID();
			const that = this;
			await this.app.fileManager.processFrontMatter(activeFile, (frontMatter) => {
				frontMatter["uniqueId"] = uniqueId;
				that.settings.mapping[uniqueId] = "";
				that.saveSettings()
			});
		}

		return uniqueId;
	}

	syncContentsToConfluence = async (confluencePageId: string, activeFileData: string, title: string): Promise<boolean> => {
		const pageContent = await this.getContentFromConfluence(confluencePageId);
		let response = await requestUrl({
			url: this.settings.confluenceHost + '/rest/api/content/' + confluencePageId,
			method: 'PUT',
			headers: {
			  'Content-Type': 'application/json;charset=utf-8',
			  'Authorization': 'Bearer ' + this.settings.personalAccessToken
			},
			body: JSON.stringify(
			{
				"version": {
					"number": pageContent["version"]["number"] + 1
				},
				"type": pageContent["type"],
				"title": title,
				"body": {
					"storage": {
						"value": "<p class=\"auto-cursor-target\"><br /></p><table class=\"wysiwyg-macro\" style=\"background-image: url('https://confluence.phonepe.com/confluence/plugins/servlet/confluence/placeholder/macro-heading?definition=e21hcmtkb3dufQ&amp;locale=en_GB&amp;version=2'); background-repeat: no-repeat;\" data-macro-name=\"markdown\" data-macro-schema-version=\"1\" data-macro-body-type=\"PLAIN_TEXT\" data-mce-resize=\"false\"><tbody><tr><td class=\"wysiwyg-macro-body\"><pre>" + activeFileData + "</pre></td></tr></tbody></table><p class=\"auto-cursor-target\"><br /></p>",
						"representation": "editor"
					}
				}
			})
		});

		if (response.status == 200) {
			return true;
		}

		return false;
	}

	getContentFromConfluence = async (confluencePageId: string): Promise<any> => {
		let response = await requestUrl({
			url: this.settings.confluenceHost + '/rest/api/content/' + confluencePageId, 
			method: 'GET',
			headers: {
				'Authorization': "Bearer " + this.settings.personalAccessToken
			}
		});

		if (response.status == 200) {
			return response.json
		}
	}

	generateUniqueID(): string {
        // Implement your unique ID generation logic here (e.g., using UUID)
        return uuidv4(); // Replace with actual generated UUID
	}
}

class CreateNewConnectionModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.createEl("h1", { text: "Create new confluence connection" });
		new Setting(contentEl)
		.setName("Confluence page link")
		.addText((text) =>
			text.onChange((value) => {
			this.result = value
		}));

		new Setting(contentEl)
		.addButton((btn) =>
			btn
			.setButtonText("Submit")
			.setCta()
			.onClick(() => {
				this.close();
				this.onSubmit(this.result);
		}));
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class ObsidianConfluenceSyncSettingTab extends PluginSettingTab {
	plugin: ObsidianConfluenceSync;

	constructor(app: App, plugin: ObsidianConfluenceSync) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Confluence Host')
			.setDesc('Host URL for Confluence')
			.addText(text => text
				.setPlaceholder('Confluence Host')
				.setValue(this.plugin.settings.confluenceHost)
				.onChange(async (value) => {
					this.plugin.settings.confluenceHost = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('Personal Access Token')
		.setDesc('Personal Access Token for Confluence')
		.addText(text => text
			.setPlaceholder('Personal Access Token')
			.setValue(this.plugin.settings.personalAccessToken)
			.onChange(async (value) => {
				this.plugin.settings.personalAccessToken = value;
				await this.plugin.saveSettings();
			}));
	}
}
