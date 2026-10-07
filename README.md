# Vision Companion

Build a first computer vision agent web app assistant that knows the user and you can ask anything and it will remember and tell you what to about the objects or you can upload feeds, image or video and it will help on all vision tasks, make the UI clean, minimal as in the reference image where the app offer user a fullscreen details and insights on screen rather than many overlaud layouts and cards are not needed for a distraction-free experience. I need us to discuss the MVP first and the UI/UX

Start with everyday users who want to identify objects in a photo and understand what they are, how they work, or what to do next.

Start with people who need help interpreting their surroundings, and focus on describing image contents and answering practical questions about what’s visible.

Use everyday object understanding as the starting audience and focus on identifying items, explaining what’s visible, and suggesting practical next steps.

Let me tap an object in the photo to open its details, explanations, and practical next steps.

Keep the photo clean until I tap an object, and reveal recognized details only on interaction.

Upload existing photos only for the MVP, and keep the flow focused on selecting a photo and tapping objects.

For memory, suggest useful memories and ask before saving. When an object identification is uncertain, state uncertainty and invite me to confirm. After tapping an object, let me ask freeform follow-up questions about it.

Use YOLO26n in the browser for object detection and invisible tap targets, alongside a vision-language assistant for object explanations, follow-up answers, and practical next steps. Be transparent when the models are unsure.

Use the attached reference image for the clean, minimal, full-screen visual direction.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ebead114-ff4d-4649-8c9e-405125eb1bc0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
