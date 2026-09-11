# Petals Flow

Background of the project: We're building a distributed LLM inference system using petals. Right now I will always have 2 VMs which are running which has the LLM layers split among each other. So when someone uses the openai like chat completions endpoint made by us, the request's LLM compute will be split among these 2 VMs, or any more VMs which might be available during runtime. 

I want you to build an individual screen where we see a code snippet on the left. There should be connecting nodes in this code snippet with 2 blocks connected in the right on top and bottom. These 2 blocks will be the hosted VMs I have. When we click on run on top right this code snippet, it has to simulate sending a request to the individual blocks which are online. Those blocks will do some computation and the final result will be generated in the right. The code block and all these individual blocks will be connected by individual wires all leading to the final answer block in the right extent

NOTE: There might be various blocks online, so the simulation UI which you're doing should have a field where I can enter the number of nodes online so that I can view clearly on how the UI handles multiple blocks if they're online and how the animations will look. 

I have attached a doc on how the distributed compute system works. Based on that I want you to design the UI where we should also display what's happening behind the scenes in those nodes, and finally I should be able to see a dummy response in the right!

MOST IMPORTANT: The animations present in this application should be intense and the ENTIRE UI you're gonna build here should look killer. Do not use any glow animations to make it look low class. Rather, the ENTIRE UI should be rich in color scheme and animations. 

Please implement this properly!

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2a177e20-ab52-4403-a00a-e518f150df76).

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
