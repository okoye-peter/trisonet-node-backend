import { Router } from "express";
import { getCountries, getRegions, getStates, getTop5Users } from "../controllers/region.controller";
import { protect } from "../middlewares/auth";

const route = Router();

route.get('/', getRegions)
route.get('/countries', getCountries)
route.get('/states', getStates)
route.get('/competitions/top-5-users', protect, getTop5Users)

export default route