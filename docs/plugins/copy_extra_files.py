import os
import shutil
from mkdocs.plugins import BasePlugin

class CopyExtraFilesPlugin(BasePlugin):
    def on_post_build(self, config):
        # Copy Google verification file
        src = os.path.join(config['docs_dir'], 'google9fcea83348cd9b56.html')
        dst = os.path.join(config['site_dir'], 'google9fcea83348cd9b56.html')
        if os.path.exists(src):
            shutil.copy2(src, dst)
            print(f"Copied verification file from {src} to {dst}")
        else:
            print(f"Warning: Verification file not found at {src}")
        return config 