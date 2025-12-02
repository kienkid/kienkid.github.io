document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById("snake-game");
    const ctx = canvas.getContext("2d");
    const headImg = new Image();
    const bodyImg = new Image();
    const foodImg = new Image();
    const wallImg = new Image();

    const startButton = document.getElementById("begin-btn");
    const levelValue = document.getElementById("select-level");
    const speedValue = document.getElementById("select-speed");

    let gameStatus = 1;

    //Skin choosing
    const skinPathElement = document.getElementById("select-skin");
    let skinPath = skinPathElement.value;
    skinPathElement.addEventListener('change', (event) => {
        skinPath = event.target.value;
        headUpPath = skinPath + 'headUp.png';
        headDownPath = skinPath + 'headDown.png';
        headLeftPath = skinPath + 'headLeft.png';
        headRightPath = skinPath + 'headRight.png';
        bodyPath = skinPath + 'body.png';
        foodPath = skinPath + 'food.png';
        wallPath = skinPath + 'wall.png';
        headImg.src = headDownPath;
        bodyImg.src = bodyPath;
        foodImg.src = foodPath;  
        wallImg.src = wallPath; 
        });
    let headUpPath = skinPath + 'headUp.png';
    let headDownPath = skinPath + 'headDown.png';
    let headLeftPath = skinPath + 'headLeft.png';
    let headRightPath = skinPath + 'headRight.png';
    let bodyPath = skinPath + 'body.png';
    let foodPath = skinPath + 'food.png';
    let wallPath = skinPath + 'wall.png';

    headImg.src = headDownPath;
    bodyImg.src = bodyPath;
    foodImg.src = foodPath;  
    wallImg.src = wallPath;  

    const gridSize = 20; //the size of each block in the canvas
    const tileCount = canvas.width / gridSize; //the game cordinate (x,y) will be from (0,0) to (width/gridSize)

    let snake = [{ x: 10, y: 11 }];
    let direction = { x: 0, y: 0 };
    let food = { x: 14, y: 13 };
    let score = 0;
    let wall = [];
    const level1 = [{ x: 0, y: 0 },{ x: 0, y: 1 },{ x: 0, y: 2 },{ x: 0, y: 3 },{ x: 0, y: 4 },{ x: 0, y: 5 },{ x: 0, y: 6 },{ x: 0, y: 7 },{ x: 0, y: 8 },{ x: 0, y: 9 },{ x: 0, y: 10 },{ x: 0, y: 11 },{ x: 0, y: 12 },{ x: 0, y: 13 },{ x: 0, y: 14 },{ x: 0, y: 15 },{ x: 0, y: 16 },{ x: 0, y: 17 },{ x: 0, y: 18 },{ x: 0, y: 19 },{ x: 0, y: 20 },{ x: 0, y: 21 },{ x: 0, y: 22 },{ x: 0, y: 23 },{ x: 0, y: 24 },{ x: 24, y: 0 },{ x: 24, y: 1 },{ x: 24, y: 2 },{ x: 24, y: 3 },{ x: 24, y: 4 },{ x: 24, y: 5 },{ x: 24, y: 6 },{ x: 24, y: 7 },{ x: 24, y: 8 },{ x: 24, y: 9 },{ x: 24, y: 10 },{ x: 24, y: 11 },{ x: 24, y: 12 },{ x: 24, y: 13 },{ x: 24, y: 14 },{ x: 24, y: 15 },{ x: 24, y: 16 },{ x: 24, y: 17 },{ x: 24, y: 18 },{ x: 24, y: 19 },{ x: 24, y: 20 },{ x: 24, y: 21 },{ x: 24, y: 22 },{ x: 24, y: 23 },{ x: 24, y: 24 },{ y: 0, x: 1 },{ y: 0, x: 2 },{ y: 0, x: 3 },{ y: 0, x: 4 },{ y: 0, x: 5 },{ y: 0, x: 6 },{ y: 0, x: 7 },{ y: 0, x: 8 },{ y: 0, x: 9 },{ y: 0, x: 10 },{ y: 0, x: 11 },{ y: 0, x: 12 },{ y: 0, x: 13 },{ y: 0, x: 14 },{ y: 0, x: 15 },{ y: 0, x: 16 },{ y: 0, x: 17 },{ y: 0, x: 18 },{ y: 0, x: 19 },{ y: 0, x: 20 },{ y: 0, x: 21 },{ y: 0, x: 22 },{ y: 0, x: 23 },{ y: 24, x: 1 },{ y: 24, x: 2 },{ y: 24, x: 3 },{ y: 24, x: 4 },{ y: 24, x: 5 },{ y: 24, x: 6 },{ y: 24, x: 7 },{ y: 24, x: 8 },{ y: 24, x: 9 },{ y: 24, x: 10 },{ y: 24, x: 11 },{ y: 24, x: 12 },{ y: 24, x: 13 },{ y: 24, x: 14 },{ y: 24, x: 15 },{ y: 24, x: 16 },{ y: 24, x: 17 },{ y: 24, x: 18 },{ y: 24, x: 19 },{ y: 24, x: 20 },{ y: 24, x: 21 },{ y: 24, x: 22 },{ y: 24, x: 23 }];
    const level2 = [{ x: 0, y: 0 },{ x: 0, y: 1 },{ x: 0, y: 2 },{ x: 0, y: 3 },{ x: 0, y: 4 },{ x: 0, y: 5 },{ x: 0, y: 19 },{ x: 0, y: 20 },{ x: 0, y: 21 },{ x: 0, y: 22 },{ x: 0, y: 23 },{ x: 0, y: 24 },{ x: 24, y: 0 },{ x: 24, y: 1 },{ x: 24, y: 2 },{ x: 24, y: 3 },{ x: 24, y: 4 },{ x: 24, y: 5 },{ x: 24, y: 19 },{ x: 24, y: 20 },{ x: 24, y: 21 },{ x: 24, y: 22 },{ x: 24, y: 23 },{ x: 24, y: 24 },{ y: 0, x: 1 },{ y: 0, x: 2 },{ y: 0, x: 3 },{ y: 0, x: 4 },{ y: 0, x: 5 },{ y: 0, x: 19 },{ y: 0, x: 20 },{ y: 0, x: 21 },{ y: 0, x: 22 },{ y: 0, x: 23 },{ y: 24, x: 1 },{ y: 24, x: 2 },{ y: 24, x: 3 },{ y: 24, x: 4 },{ y: 24, x: 5 },{ y: 24, x: 19 },{ y: 24, x: 20 },{ y: 24, x: 21 },{ y: 24, x: 22 },{ y: 24, x: 23 },{ y: 6, x: 6 },{ y: 7, x: 6 },{ y: 8, x: 6 },{ y: 9, x: 6 },{ y: 6, x: 7 },{ y: 6, x: 8 },{ y: 6, x: 9 },{ y: 18, x: 18 },{ y: 17, x: 18 },{ y: 16, x: 18 },{ y: 15, x: 18 },{ y: 18, x: 17 },{ y: 18, x: 16 },{ y: 18, x: 15 },{ y: 18, x: 6 },{ y: 18, x: 7 },{ y: 18, x: 8 },{ y: 18, x: 9 },{ y: 17, x: 6 },{ y: 16, x: 6 },{ y: 15, x: 6 },{ x: 18, y: 6 },{ x: 18, y: 7 },{ x: 18, y: 8 },{ x: 18, y: 9 },{ x: 17, y: 6 },{ x: 16, y: 6 },{ x: 15, y: 6 }];
    const level3 = [{ x: 12, y: 0 },{ x: 12, y: 1 },{ x: 12, y: 2 },{ x: 12, y: 3 },{ x: 12, y: 4 },{ x: 12, y: 5 },{ x: 12, y: 6 },{ x: 12, y: 7 },{ x: 12, y: 8 },{ x: 12, y: 9 },{ x: 12, y: 10 },{ x: 12, y: 11 },{ x: 12, y: 12 },{ x: 12, y: 13 },{ x: 12, y: 14 },{ x: 12, y: 15 },{ x: 12, y: 16 },{ x: 12, y: 17 },{ x: 12, y: 18 },{ x: 12, y: 19 },{ x: 12, y: 20 },{ x: 12, y: 21 },{ x: 12, y: 22 },{ x: 12, y: 23 },{ x: 12, y: 24 },{ y: 12, x: 1 },{ y: 12, x: 2 },{ y: 12, x: 3 },{ y: 12, x: 4 },{ y: 12, x: 5 },{ y: 12, x: 6 },{ y: 12, x: 7 },{ y: 12, x: 8 },{ y: 12, x: 9 },{ y: 12, x: 10 },{ y: 12, x: 11 },{ y: 12, x: 12 },{ y: 12, x: 13 },{ y: 12, x: 14 },{ y: 12, x: 15 },{ y: 12, x: 16 },{ y: 12, x: 17 },{ y: 12, x: 18 },{ y: 12, x: 19 },{ y: 12, x: 20 },{ y: 12, x: 21 },{ y: 12, x: 22 },{ y: 12, x: 23 },{ y: 12, x: 0 },{ y: 12, x: 24 }];
    const level4 = [{ x: 0, y: 0 },{ x: 1, y: 1 },{ x: 2, y: 2 },{ x: 3, y: 3 },{ x: 4, y: 4 },{ x: 5, y: 5 },{ x: 6, y: 6 },{ x: 7, y: 7 },{ x: 8, y: 8 },{ x: 9, y: 9 },{ x: 10, y: 10 },{ x: 11, y: 11 },{ x: 13, y: 13 },{ x: 14, y: 14 },{ x: 15, y: 15 },{ x: 16, y: 16 },{ x: 17, y: 17 },{ x: 18, y: 18 },{ x: 19, y: 19 },{ x: 20, y: 20 },{ x: 21, y: 21 },{ x: 22, y: 22 },{ x: 23, y: 23 },{ x: 24, y: 24 },{ x: 24, y: 0 },{ x: 23, y: 1 },{ x: 22, y: 2 },{ x: 21, y: 3 },{ x: 20, y: 4 },{ x: 19, y: 5 },{ x: 18, y: 6 },{ x: 17, y: 7 },{ x: 16, y: 8 },{ x: 15, y: 9 },{ x: 14, y: 10 },{ x: 13, y: 11 },{ x: 11, y: 13 },{ x: 10, y: 14 },{ x: 9, y: 15 },{ x: 8, y: 16 },{ x: 7, y: 17 },{ x: 6, y: 18 },{ x: 5, y: 19 },{ x: 4, y: 20 },{ x: 3, y: 21 },{ x: 2, y: 22 },{ x: 1, y: 23 },{ x: 0, y: 24 }];
    const level5 = [{ x: 1, y: 1 },{ x: 4, y: 1 },{ x: 7, y: 1 },{ x: 10, y: 1 },{ x: 14, y: 1 },{ x: 17, y: 1 },{ x: 20, y: 1 },{ x: 23, y: 1 },{ x: 1, y: 4 },{ x: 4, y: 4 },{ x: 7, y: 4 },{ x: 10, y: 4 },{ x: 14, y: 4 },{ x: 17, y: 4 },{ x: 20, y: 4 },{ x: 23, y: 4 },{ x: 1, y: 7 },{ x: 4, y: 7 },{ x: 7, y: 7 },{ x: 10, y: 7 },{ x: 14, y: 7 },{ x: 17, y: 7 },{ x: 20, y: 7 },{ x: 23, y: 7 },{ x: 1, y: 10 },{ x: 4, y: 10 },{ x: 7, y: 10 },{ x: 10, y: 10 },{ x: 14, y: 10 },{ x: 17, y: 10 },{ x: 20, y: 10 },{ x: 23, y: 10 },{ x: 1, y: 14 },{ x: 4, y: 14 },{ x: 7, y: 14 },{ x: 10, y: 14 },{ x: 14, y: 14 },{ x: 17, y: 14 },{ x: 20, y: 14 },{ x: 23, y: 14 },{ x: 1, y: 17 },{ x: 4, y: 17 },{ x: 7, y: 17 },{ x: 10, y: 17 },{ x: 14, y: 17 },{ x: 17, y: 17 },{ x: 20, y: 17 },{ x: 23, y: 17 },{ x: 1, y: 20 },{ x: 4, y: 20 },{ x: 7, y: 20 },{ x: 10, y: 20 },{ x: 14, y: 20 },{ x: 17, y: 20 },{ x: 20, y: 20 },{ x: 23, y: 20 },{ x: 1, y: 23 },{ x: 4, y: 23 },{ x: 7, y: 23 },{ x: 10, y: 23 },{ x: 14, y: 23 },{ x: 17, y: 23 },{ x: 20, y: 23 },{ x: 23, y: 23 }];

    function drawTile(x, y, img) {
    ctx.drawImage(img, x * gridSize, y * gridSize, gridSize ,gridSize); //draw a block at a cordinate with size slightly smaller than that block 2 pixel
    }

    function drawMap(lv) {
    if (lv == 1) {wall = level1};
    if (lv == 2) {wall = level2};
    if (lv == 3) {wall = level3};
    if (lv == 4) {wall = level4};
    if (lv == 5) {wall = level5};
    }


    function generateFood(tileCount, wall) {
    let newFood;
    do {
        newFood = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount)
        };
    } while (
        wall.some(segment => segment.x === newFood.x && segment.y === newFood.y) ||
        snake.some(segment => segment.x === newFood.x && segment.y === newFood.y)
        )
    return newFood;
    }


    function drawGame(level) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        //Choose Map
        drawMap(level);

        // Move snake (add the head position to the front of the snake array, if not collision with anything => remove the last item in snake array to make it move)
        const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
        snake.unshift(head);

        // Check collision with food (if the position of the head = position of the food => adding 1 to score, replace food with random position and not calling pop => snake array increase)
        if (head.x === food.x && head.y === food.y) {
            score++;
            food = generateFood(tileCount, wall);
        } else {
            snake.pop();
        }

        // Going through wall condition
        if (head.x < 0) {head.x = tileCount} 
        else if (head.x >= tileCount) {head.x = 0}
        else if (head.y >= tileCount) {head.y = 0}
        else if (head.y < 0) {head.y = tileCount}

        // Check collision with walls or self (check if head position match with other segment of the snake [beside the head position] or the wall)
        if (
            (snake.slice(1).some(segment => segment.x === head.x && segment.y === head.y)) || (wall.some(segment => segment.x === head.x && segment.y === head.y))
        ) {
            alert("Game Over! Score: " + score);
            snake = [{ x: 10, y: 11 }];
            direction = { x: 0, y: 0 };
            score = 0;
            food = { x: 14, y: 13 };
            gameStatus = 0;
        }

        // Draw food
        drawTile(food.x, food.y, foodImg);

        // Draw wall
        wall.forEach((wallsegment, index) => {
            drawTile(wallsegment.x, wallsegment.y, wallImg);
        });

        // Draw snake
        snake.forEach((segment, index) => {
            drawTile(segment.x, segment.y, index === 0 ? headImg : bodyImg); /* index 0 is the head */
        });

        // Draw score
        ctx.fillStyle = "black";
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Score: " + score, canvas.width / 2, 16);
    }

    document.addEventListener("keydown", e => {
    switch (e.key) {
        case "ArrowUp": if (direction.y === 0) {direction = { x: 0, y: -1 }; headImg.src = headUpPath}; e.preventDefault(); break;
        case "ArrowDown": if (direction.y === 0) {direction = { x: 0, y: 1 }; headImg.src = headDownPath}; e.preventDefault(); break;
        case "ArrowLeft": if (direction.x === 0) {direction = { x: -1, y: 0 }; headImg.src = headLeftPath}; e.preventDefault(); break;
        case "ArrowRight": if (direction.x === 0) {direction = { x: 1, y: 0 }; headImg.src = headRightPath}; e.preventDefault(); break;
        case "w": if (direction.y === 0) {direction = { x: 0, y: -1 }; headImg.src = headUpPath}; e.preventDefault(); break;
        case "s": if (direction.y === 0) {direction = { x: 0, y: 1 }; headImg.src = headDownPath}; e.preventDefault(); break;
        case "a": if (direction.x === 0) {direction = { x: -1, y: 0 }; headImg.src = headLeftPath}; e.preventDefault(); break;
        case "d": if (direction.x === 0) {direction = { x: 1, y: 0 }; headImg.src = headRightPath}; e.preventDefault(); break;
        case "W": if (direction.y === 0) {direction = { x: 0, y: -1 }; headImg.src = headUpPath}; e.preventDefault(); break;
        case "S": if (direction.y === 0) {direction = { x: 0, y: 1 }; headImg.src = headDownPath}; e.preventDefault(); break;
        case "A": if (direction.x === 0) {direction = { x: -1, y: 0 }; headImg.src = headLeftPath}; e.preventDefault(); break;
        case "D": if (direction.x === 0) {direction = { x: 1, y: 0 }; headImg.src = headRightPath}; e.preventDefault(); break;
    }
    });

    function beginGame () {
        gameStatus = 1
        let intervalId = setInterval(()=> {
        if (gameStatus == 0) {
            clearInterval(intervalId);
        } else {
            drawGame(levelValue.value);
        }
    }, speedValue.value);}

    startButton.addEventListener('click', beginGame);
});