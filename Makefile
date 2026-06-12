.PHONY: test test-web test-tools test-server serve serve-web

test: test-web test-tools test-server

test-web:
	node --test smpl_web_viewer/tests/*.test.js tests/smpl_viewer_local_data.test.js

test-tools:
	PYTHONPATH=smpl_web_viewer python3 -m unittest discover -s smpl_web_viewer/tests -p 'test_*.py'

test-server:
	python3 -m unittest tests.test_server

serve:
	bash smpl_viewer/run.sh

serve-web:
	node smpl_web_viewer/tools/static_server.mjs --root smpl_web_viewer --port 5174
