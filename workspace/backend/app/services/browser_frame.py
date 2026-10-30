"""Small display frames; agent captures retain their original resolution."""
from io import BytesIO
from PIL import Image

SD_SIZE = (854, 480)


def standard_browser_frame(data: bytes) -> bytes:
    """Fit inside 480p without stretching, cropping, or upscaling."""
    with Image.open(BytesIO(data)) as source:
        frame = source.convert('RGB')
        frame.thumbnail(SD_SIZE, Image.Resampling.LANCZOS)
        output = BytesIO()
        frame.save(output, format='JPEG', quality=75, optimize=True)
        return output.getvalue()
