# Manny.AI 🔧

![Manny.ai Logo](frontend/public/logo.png)
> _"You break it, we fix it!"_

A handy AI-powered CAD assistant that helps you modify and analyze 3D models.

## Installation

### Prerequisites

* Python 3.9+
* Node.js (v18+)
* OpenAI API Key

### Setup Instructions

1. **Clone the Repository**
```bash
git clone https://github.com/pranavputtagunta/manny-ai.git
cd manny-ai

```


2. **Environment Configuration**
Create a .env file in the root directory and add your OpenAI credentials:
```env
OPENAI_API_KEY=your_actual_key_here

```


3. **Backend Setup**
```bash
cd backend
pip install -r requirements.txt
python src/main.py

```


4. **Frontend Setup**
```bash
cd ../frontend
npm install
npm run dev

```



---

## Inspiration

The main motivation for **Manny.ai** was the **"CAD Tax"**—the immense time and financial barrier that prevents early-stage startups from moving from a digital idea to a physical product. Traditional CAD software is notoriously rigid, with a learning curve so steep it often requires years of expertise or expensive consultants just to make a model "printable." We noticed that for teams without a dedicated mechanical engineer, preparing models for 3D printing is a grueling manual process; guidelines for wall thickness and support structures aren't standard, forcing founders to spend hours revamping models just to fit a specific printer's requirements.

Seeing the success of AI "Copilots" in accelerating software startups, we saw an opening to bring that same innovation to the hardware world. We built **Manny**, inspired by the handyman *Handy Manny* and his slogan "You break it, we fix it," to act as an AI co-founder that bridges the gap between a founder’s vision and a manufacturable reality through simple conversation.

## What it does

Manny.ai is an AI-powered CAD refinement and analysis engine. It allows users to upload **STEP files** and modify them via a natural language chatbot.

* **Intelligent Refinement:** Users can select specific areas of a model to modify, generate new features, or automatically adjust the geometry to meet 3D printing standards.
* **Dynamic Simulation:** Manny generates real-time **spatial heatmaps** based on user context (e.g., "show me the weak points on this design if X impact were to happen" or "generate heatmaps to show water flow in this irrigation system"). This allows teams to visualize weak points, temperature risks, or wind resistance without needing a PhD in simulation.
* **Version Control:** Like Git for 3D, Manny supports full versioning. If a change doesn't meet your standards, you can revert to any previous state instantly.

## How we built it

Manny is built on a sophisticated pipeline that bridges "fuzzy" LLM reasoning with the deterministic math of engineering kernels by integrating an advanced geometry engine.

### The Architecture

* **Frontend:** React and **React Three Fiber (R3F)** for high-performance 3D viewports.
* **Backend:** Python-based system managing version control, RESTful APIs, and event handling.
* **Manny Core:** Powered by **OpenAI o3-mini** for its balance of complex reasoning and speed.
* **Geometry Engine:** **CadQuery**, chosen because it is a "universal" CAD language that generates features embedded with metadata, making files compatible with industry standards like SolidWorks or AutoCAD.
* **Analysis:** **Trimesh** and **Numpy** compute vertex physics for heatmaps, which are rendered via custom GLSL shaders.

**Selection Tool (Raycasting)**
When you click on the model in our React Three Fiber frontend, we use Raycasting to project a laser from the camera through the mouse position into the 3D scene. When that "laser" hits the model, it returns a precise (x, y, z) coordinate on the surface of the mesh. If you drag to select an area, we capture a dense cloud of these points. Manny.ai applies **Topological Graph Traversal**—instead of keeping track of millions of pixels, we look at the models as boolean subtractions, which is more performant and gives the AI a structural understanding rather than scattered points.

### Technical Innovation: Indexed Boundary Representation

To give the AI a nuanced understanding of a model without relying on screenshots, we serialize STEP files into a machine-readable **topological graph**. We use an **Indexed Boundary Representation (B-Rep)** design, structuring JSON data so a face points to a loop of edges, which in turn points to vertices. This allows the LLM to traverse the object as a graph.

### The 3-Phase Prompting Pipeline

1. **Intent Classification:** Determines if the user wants a modification, a query, or a simulation.
2. **Architect Phase:** A Senior Engineer agent translates vague intent (e.g., "make it stronger") into strict geometric instructions ("increase wall thickness by 2mm").
3. **Database Query:** We query a database of Python scripts from an open-source CadQuery repository to train the LLM on "good practice" syntax before writing the code.
4. **Coder Phase:** The generator agent writes the actual CadQuery code, cross-referencing the database to ensure syntax accuracy.

## Challenges we ran into

### 1. Topology Loss

In CAD, changing a single face often causes the IDs of all surrounding edges to shift. When the AI tried to "fillet edges" after a modification, the **OpenCASCADE** kernel would often crash with `ChFi3d_Builder` errors because the original edge references were gone.

* **Solution:** We implemented a **Reflection Loop** that captures kernel errors and feeds them back to the AI for immediate self-correction. We capped this at 3 attempts to prevent the AI from going down "rabbit holes."

### 2. The Token Limit Wall

Our selection tool allows users to pick vertices in 3D space. However, mapping thousands of raw points (x, y, z) into the LLM context quickly exceeded token limits.

* **Solution:** We developed a **Geometric Bounding** summarizer. Instead of passing every point, we pass a summarized description and a multidimensional array of key boundary points, reducing token usage by 80% while maintaining precision.

## Accomplishments that we're proud of

We successfully bridged 3D data with LLMs to create a tool that doesn't just produce "dumb meshes," but provides genuine, complex engineering insights. Seeing a user ask a spatial question and watching Manny generate a mathematically grounded heatmap in seconds was our proudest moment.

## What we learned

We learned that building a successful AI engineering tool for startups requires creating a **sandbox** that balances LLM creativity with adherence to niche, rigid syntax. We found that deterministic safeguards—like our reflection loops and B-Rep serialization—are often more valuable than "better prompts."

## What's next for Manny.ai

Our next step is moving toward **Simulation-Driven Design**. We plan to integrate a full FEA (Finite Element Analysis) suite so Manny can not only suggest changes but prove they work through stress testing and thermal analysis. We are also exploring **Multi-User Collaborative CAD**, allowing entire teams to iterate on a single STEP file simultaneously in a shared environment—the "Google Docs of Hardware."

---

Would you like me to help you draft a sample `requirements.txt` for the backend to ensure your CadQuery and OpenCASCADE environment is correctly configured?
